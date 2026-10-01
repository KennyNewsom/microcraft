#include "Platform.h"
#include "Palette.h"
#include "World.h"
#include "Gameplay.h"
#include "ChunkCodec.h"
#include <cstring>

// The same protocol/game logic runs with either platform, without heap allocation.
static uint8_t packet[64];
static uint8_t nonce[8];
static World world;
static Gameplay gameplay(world);
static ChunkCodec chunkCodec;
static uint32_t expected = 0;
static bool running = false;
static bool configured = false;
struct Player { int32_t position[3]; bool active; };
static Player players[4] = {}; // Fixed player slots; positions use 1/32 block units.

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
    if(!Platform::send(packet)) Platform::halt('X');
}
static void fail(uint8_t code) {
    running = false;
    packet[4] = 255;
    memset(packet + 12, 0, 48);
    packet[12] = code;
    send();
    Platform::halt('X');
}
static bool receive(bool initial) {
    if(!Platform::receive(packet,initial)) return false;
    return memcmp(packet, "MCB1", 4) == 0 && packet[5] == 0 && packet[6] == 48 && packet[7] == 0
        && get32(packet + 60) == crc(packet, 60);
}

int main() {
    Platform::init();
    Platform::display('L');
    if (!receive(true)) fail(1);
    if (packet[4] != 1 || get32(packet + 8) != 0) fail(2);
    memcpy(nonce, packet + 12, 8);
    uint32_t baud = get32(packet + 20);
    if (baud != 115200 && baud != 230400 && baud != 460800 && baud != 921600 && baud != 1000000) fail(3);
    send();
    Platform::delay(100);
    if (!Platform::baud(baud)) fail(3);
    for (expected = 1; expected <= 10000; ++expected) {
        if (!receive(false)) fail(4);
        if (packet[4] != 2 || get32(packet + 8) != expected) fail(5);
        send(); // Exact 64-byte echo, including original payload and CRC.
    }
    if (!receive(false)) fail(6);
    if (packet[4] != 3 || get32(packet + 8) != expected || memcmp(packet + 12, nonce, 8)) fail(7);
    running = true;
    packet[4] = 131;
    send();
    Platform::display('S');
    ++expected;
    while (running) {
        // Host must keep polling at least every 2 seconds, even without players.
        if (!receive(false)) fail(8);
        if (get32(packet + 8) != expected++) fail(9);
        uint8_t op = packet[4];
        uint8_t *p=packet+12;
        uint8_t actor=p[47];
        if ((op==5 || op==8 || op==9 || op==10) && actor>=4) fail(14);
        int32_t *player=players[actor<4 ? actor : 0].position;
        if(op==4) {
            memset(p,0,48);
            put32(p,sizeof(world)); put32(p+4,STATE_COUNT);
            put32(p+8,7); put32(p+12,4); put32(p+16,World::HEIGHT);
            put32(p+20,World::SLOTS); put32(p+24,world.used);
            put32(p+28,World::CAPACITY*3/4);
            put32(p+32,World::CAPACITY); put32(p+36,Platform::stackUsed());
#ifdef MICROCRAFT_BAREMETAL
            put32(p+40,1);
#endif
            put32(p+44,3); // Column/RLE chunk codec and compact edit restore.
        } else if(op==11) {
            if(configured) fail(12);
            world.seed=get32(p); configured=true;
        } else if(op==12) {
            unsigned slot=p[0]; int32_t x=int32_t(get32(p+1)),z=int32_t(get32(p+5));
            if(!configured || slot>=World::SLOTS || world.chunks[slot].active ||
               x < -62500 || x > 62499 || z < -62500 || z > 62499 || world.find(x,z)>=0) fail(12);
            world.chunks[slot]={x,z,true,false};
            memset(p,0,48); p[0]=1;
        } else if(op==19) {
            unsigned slot=p[0];
            if(slot>=World::SLOTS || !world.chunks[slot].active || p[1] || p[2]) fail(12);
            chunkCodec.begin();
            do { chunkCodec.encode(world,slot,p); packet[4]=op|128; send(); } while(chunkCodec.cursor<32768);
            continue;
        } else if(op==20) {
            unsigned slot=p[0],count=p[1]; uint16_t indices[32],states[32];
            if(slot>=World::SLOTS || !world.chunks[slot].active || !decodeEdits(p,indices,states,STATE_COUNT)) fail(13);
            bool ok=true;
            for(unsigned i=0;i<count;++i) if(!world.set(slot,indices[i],states[i],false)) { ok=false; break; }
            memset(p,0,48); p[0]=ok;
        } else if(op==13 || op==18) {
            unsigned slot=p[0], cursor=p[1]|unsigned(p[2])<<8;
            if(slot>=World::SLOTS || !world.chunks[slot].active || cursor>32768) fail(12);
            do {
            memset(p,0,48); unsigned count=0;
            while(cursor<32768 && count<15) {
                uint16_t value=world.get(slot,cursor); unsigned length=1;
                while(length<255 && cursor+length<32768 && world.get(slot,cursor+length)==value) ++length;
                p[3+count*3]=length; p[4+count*3]=value; p[5+count*3]=value>>8; ++count; cursor+=length;
            }
            p[0]=cursor; p[1]=cursor>>8; p[2]=count;
            if(op==18) { packet[4]=op|128; send(); }
            } while(op==18 && cursor<32768);
            if(op==18) continue;
        } else if(op==14) {
            unsigned slot=p[0],count=p[1];
            if(slot>=World::SLOTS || !world.chunks[slot].active || count>11) fail(12);
            bool ok=true;
            for(unsigned i=0;i<count;i++) {
                unsigned index=p[2+i*4]|unsigned(p[3+i*4])<<8; uint16_t value=p[4+i*4]|unsigned(p[5+i*4])<<8;
                if(index>=32768 || value>=STATE_COUNT || (index%128==0 && value!=1)) fail(13);
                if(!world.set(slot,index,value,false)) { ok=false; break; }
            }
            memset(p,0,48); p[0]=ok;
        } else if(op==15 || op==16 || op==17) {
            unsigned slot=p[0];
            if(slot>=World::SLOTS || !world.chunks[slot].active) fail(12);
            if(op==15) {
                if(world.chunks[slot].dirty) fail(12);
                world.unload(slot); memset(p,0,48); p[0]=1;
            } else if(op==16) {
                world.chunks[slot].dirty=false; memset(p,0,48); p[0]=1;
            } else {
                unsigned cursor=p[1]|unsigned(p[2])<<8,count=0;
                if(cursor>World::CAPACITY) fail(12);
                bool dirty=world.chunks[slot].dirty;
                memset(p,0,48);
                while(cursor<World::CAPACITY && count<11) {
                    uint32_t key=world.keys[cursor];
                    if(key<World::DELETED && ((key&World::KEY_MASK)>>15)==slot) {
                        unsigned index=key&32767;
                        uint16_t value=world.stored(cursor);
                        p[4+count*4]=index; p[5+count*4]=index>>8; p[6+count*4]=value; p[7+count*4]=value>>8; ++count;
                    }
                    ++cursor;
                }
                p[0]=cursor; p[1]=cursor>>8; p[2]=count; p[3]=dirty;
            }
        } else if(op==5) {
            int x=int32_t(get32(p)),y=int32_t(get32(p+4)),z=int32_t(get32(p+8));
            uint16_t block=p[12]|unsigned(p[13])<<8;
            bool bounds=x>=-1000000 && x<1000000 && z>=-1000000 && z<1000000 && y>=0 && y<128;
            int slot=bounds ? world.find(World::floorDiv(x,16),World::floorDiv(z,16)) : -1;
            int64_t dx=int64_t(x)*32+16-player[0],dy=int64_t(y)*32+16-(int64_t(player[1])+48),dz=int64_t(z)*32+16-player[2];
            bool valid=players[actor].active && bounds && slot>=0 && p[14]<=2 &&
                dx*dx+dy*dy+dz*dz<=208*208;
            uint8_t reason=valid ? 0 : 1;
            world.clearChanges();
            if(valid) valid=gameplay.edit(x,y,z,block,p[14],p[15],p[16],p[17],p[18],p[19],p[20],reason);
            memset(p,0,48); put32(p,x); put32(p+4,y); put32(p+8,z);
            slot=world.slotAt(x,y,z); unsigned index=world.indexAt(x,y,z);
            uint16_t value=slot>=0 ? world.get(slot,index) : 0;
            p[13]=valid; p[14]=value; p[18]=value>>8;
            p[15]=slot>=0 && value==world.base(slot,index); p[16]=reason;
            for(unsigned i=0;i<13;i++) { p[20+i]=world.changed[i]; if(world.changed[i]) p[17]=1; }
        } else if(op==29) {
            unsigned slot=p[0];
            if(slot>=World::SLOTS || !world.chunks[slot].active) fail(12);
            uint32_t start=Platform::cycles(),checksum=0;
            for(unsigned i=0;i<32768;++i) checksum=checksum*33+world.get(slot,i);
            uint32_t elapsed=Platform::cycles()-start;
            memset(p,0,48); put32(p,elapsed); put32(p+4,checksum);
        } else if(op==30) {
            // Maintenance reset is only allowed after all player views are saved
            // and unloaded. The public bridge never forwards this opcode.
            for(const auto &c:world.chunks) if(c.active) fail(12);
            for(const auto &player:players) if(player.active) fail(12);
            if(world.used) fail(12);
            memset(p,0,48); packet[4]=op|128; send(); Platform::delay(20); Platform::reset();
        } else if(op==27) {
            world.clearChanges(); gameplay.settle(); memset(p,0,48); p[13]=1;
            for(unsigned i=0;i<13;i++) { p[20+i]=world.changed[i]; if(world.changed[i]) p[17]=1; }
        } else if(op==8) {
            int32_t next[3]; for(unsigned i=0;i<3;i++) next[i]=int32_t(get32(p+i*4));
            bool valid=players[actor].active && next[0]>=-32000000 && next[0]<32000000 &&
                next[2]>=-32000000 && next[2]<32000000 && next[1]>=32 && next[1]<127*32;
            if(valid) memcpy(player,next,12);
            memcpy(p,player,12); p[12]=valid;
        } else if(op==9) {
            bool valid=configured && !players[actor].active;
            if(valid) { players[actor].active=true; player[0]=512+actor*64; player[1]=320; player[2]=512; }
            memcpy(p,player,12); p[12]=valid;
        } else if(op==10) {
            players[actor].active=false; memset(p,0,48); p[12]=1;
        } else fail(11);
        packet[4] = op | 128;
        send();
    }
}
