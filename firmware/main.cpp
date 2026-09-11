#include "MicroBit.h"
#include "Palette.h"
#include <cstring>

MicroBit uBit;
// No heap allocations in application logic; CODAL has its own runtime budget.
static uint8_t packet[64];
static uint8_t nonce[8];
static uint8_t world[32 * 32 * 32];
static uint32_t expected = 0;
static bool running = false;
static bool loading = true;
struct Player { int16_t position[3]; bool active; };
static Player players[2] = {}; // Fixed player slots; positions use 1/32 block units.

static uint32_t get32(const uint8_t *p) {
    return uint32_t(p[0]) | uint32_t(p[1]) << 8 | uint32_t(p[2]) << 16 | uint32_t(p[3]) << 24;
}
static void put32(uint8_t *p, uint32_t x) {
    for (int i = 0; i < 4; ++i) p[i] = x >> (i * 8);
}
static uint32_t crc(const uint8_t *p, int n) {
    uint32_t c = 0xffffffff;
    while (n--) {
        c ^= *p++;
        for (int j = 0; j < 8; ++j) c = (c >> 1) ^ (0xedb88320u & (0u - (c & 1)));
    }
    return ~c;
}
static void send() {
    put32(packet + 60, crc(packet, 60));
    uBit.serial.send(packet, 64, SYNC_SPINWAIT);
}
static void fail(uint8_t code) {
    running = false;
    packet[4] = 255;
    memset(packet + 12, 0, 48);
    packet[12] = code;
    send();
    uBit.display.print('X');
    // Physical reset required after any link failure. Never retry silently.
    while (true) uBit.sleep(1000);
}
static bool receive(bool initial) {
    unsigned got = 0;
    uint64_t start = system_timer_current_time();
    while (got < sizeof(packet)) {
        int c = uBit.serial.read(ASYNC);
        if (c >= 0) packet[got++] = c;
        else if (got == 0 && initial) uBit.sleep(1);
        if ((!initial || got) && system_timer_current_time() - start > 2000) return false;
        if (initial && got == 0) start = system_timer_current_time();
    }
    return memcmp(packet, "MCB1", 4) == 0 && packet[5] == 0 && packet[6] == 48 && packet[7] == 0
        && get32(packet + 60) == crc(packet, 60);
}
static unsigned index(unsigned x, unsigned y, unsigned z) { return (y * 32 + z) * 32 + x; }

int main() {
    uBit.init();
    uBit.serial.setRxBufferSize(254);
    uBit.serial.setTxBufferSize(128);
    uBit.serial.setBaud(115200);
    uBit.display.print('L');
    if (!receive(true)) fail(1);
    if (packet[4] != 1 || get32(packet + 8) != 0) fail(2);
    memcpy(nonce, packet + 12, 8);
    uint32_t baud = get32(packet + 20);
    if (baud != 115200 && baud != 230400 && baud != 460800 && baud != 921600 && baud != 1000000) fail(3);
    send();
    uBit.sleep(100);
    if (uBit.serial.setBaud(baud) != DEVICE_OK) fail(3);
    for (expected = 1; expected <= 10000; ++expected) {
        if (!receive(false)) fail(4);
        if (packet[4] != 2 || get32(packet + 8) != expected) fail(5);
        send(); // Exact 64-byte echo, including original payload and CRC.
    }
    if (!receive(false)) fail(6);
    if (packet[4] != 3 || get32(packet + 8) != expected || memcmp(packet + 12, nonce, 8)) fail(7);
    // World generation is performed on the micro:bit only after the gate passes.
    for (unsigned y = 0; y < 32; ++y)
        for (unsigned z = 0; z < 32; ++z)
            for (unsigned x = 0; x < 32; ++x)
                world[index(x,y,z)] = y == 0 ? 1 : y < 7 ? 2 : y == 7 ? 3 : 0;
    running = true;
    packet[4] = 131;
    send();
    uBit.display.print('S');
    ++expected;
    while (running) {
        // Host must keep polling at least every 2 seconds, even without players.
        if (!receive(false)) fail(8);
        if (get32(packet + 8) != expected++) fail(9);
        uint8_t op = packet[4];
        uint8_t actor = packet[59]; // Last payload byte selects the MCU player slot.
        if ((op == 5 || op == 8 || op == 9 || op == 10) && actor >= 2) fail(14);
        int16_t *player = players[actor < 2 ? actor : 0].position;
        unsigned x = packet[12], y = packet[13], z = packet[14];
        if (op == 4) { // Heartbeat.
            memset(packet + 12, 0, 48);
            put32(packet + 12, sizeof(world));
            put32(packet + 16, BLOCK_PALETTE_SIZE);
            put32(packet + 20, 2); // Runtime protocol revision.
            put32(packet + 24, 2); // Maximum player count.
        } else if (op == 5) { // Creative block edit; fixed palette, bounds, immutable floor.
            uint8_t block = packet[15];
            loading = false;
            int dx = int(x * 32 + 16) - player[0];
            int dy = int(y * 32 + 16) - (player[1] + 48);
            int dz = int(z * 32 + 16) - player[2];
            bool valid = players[actor].active && x < 32 && y > 0 && y < 32 && z < 32 && block < BLOCK_PALETTE_SIZE
                && dx * dx + dy * dy + dz * dz <= 208 * 208;
            packet[16] = valid ? 1 : 0;
            if (valid) world[index(x,y,z)] = block;
        } else if (op == 6) { // Read one bounded 48-byte world page for PC storage/network.
            uint32_t offset = get32(packet + 12);
            if (offset >= sizeof(world)) fail(10);
            memset(packet + 12, 0, 48);
            unsigned length = sizeof(world) - offset;
            if (length > 48) length = 48;
            memcpy(packet + 12, world + offset, length);
        } else if (op == 7) { // Restore a validated page from PC storage before play.
            uint32_t offset = get32(packet + 12);
            if (!loading || offset >= sizeof(world)) fail(12);
            unsigned length = sizeof(world) - offset;
            if (length > 44) length = 44;
            for (unsigned i = 0; i < length; ++i) {
                uint8_t b = packet[16 + i];
                if (b >= BLOCK_PALETTE_SIZE || (offset + i < 1024 && b != 1)) fail(13);
            }
            memcpy(world + offset, packet + 16, length);
        } else if (op == 8) { // Creative movement, validated and stored on the MCU.
            loading = false;
            int16_t next[3];
            memcpy(next, packet + 12, 6);
            bool valid = players[actor].active && next[0] >= 0 && next[0] < 1024 && next[1] >= 32 && next[1] < 960
                && next[2] >= 0 && next[2] < 1024;
            if (valid) memcpy(player, next, 6);
            memcpy(packet + 12, player, 6);
            packet[18] = valid;
        } else if (op == 9) { // Reserve one of two independent player slots.
            loading = false;
            bool valid = !players[actor].active;
            if (valid) {
                players[actor].active = true;
                player[0] = 512 + actor * 64; player[1] = 320; player[2] = 512;
            }
            memcpy(packet + 12, player, 6);
            packet[18] = valid;
        } else if (op == 10) {
            players[actor].active = false;
            packet[18] = 1;
        } else { fail(11); }
        packet[4] = op | 128;
        send();
    }
}
