// nRF52833 register offsets: Nordic product specification v1.3, UARTE/CLOCK/GPIO.
// micro:bit V2 target UART: TX=P0.06, RX=P1.08. DAPLink stays on the interface MCU.
#include "../Platform.h"
#include <string.h>
namespace {
inline volatile uint32_t &reg(uint32_t address) { return *reinterpret_cast<volatile uint32_t*>(address); }
constexpr uint32_t UART=0x40002000;
volatile uint32_t ticks=0;
volatile char glyph='L';
alignas(4) uint8_t rx[64];
unsigned row=0;
constexpr unsigned rows[]={21,22,15,24,19},cols[]={28,11,31,37,30};
void pin(unsigned p,bool high) { reg((p<32 ? 0x50000000 : 0x50000300)+(high ? 0x508 : 0x50c))=1u<<(p%32); }
void output(unsigned p,bool high) { pin(p,high); reg((p<32 ? 0x50000000 : 0x50000300)+0x700+(p%32)*4)=3; }
bool wait(uint32_t offset,unsigned timeout=1000) {
    uint32_t start=ticks;
    while(!reg(UART+offset)) if(uint32_t(ticks-start)>=timeout) return false;
    return true;
}
void armRx() {
    reg(UART+0x110)=0; reg(UART+0x14c)=0; reg(UART+0x108)=0;
    reg(UART+0x534)=uint32_t(rx); reg(UART+0x538)=64;
    reg(UART)=1;
}
}
extern "C" void SysTick_Handler() {
    ++ticks;
    pin(rows[row],false); row=(row+1)%5;
    const uint8_t l[]={16,16,16,16,31},s[]={15,16,14,1,30},x[]={17,10,4,10,17};
    uint8_t bits=(glyph=='S' ? s : glyph=='X' ? x : l)[row];
    for(unsigned c=0;c<5;++c) pin(cols[c],!(bits&(16>>c)));
    pin(rows[row],true);
}
namespace Platform {
void init() {
    // No SoftDevice, interrupts, heap, or scheduler inherited from CODAL.
    reg(0xe000ed08)=0; // Vector table in application flash at address zero.
    reg(0x4001e540)=1; // Enable nRF52833's instruction cache to reduce flash stalls.
    asm volatile("dsb\n isb" ::: "memory");
    reg(0xe000edfc)|=1u<<24; reg(0xe0001004)=0; reg(0xe0001000)|=1;
    for(unsigned p:rows) output(p,false);
    for(unsigned p:cols) output(p,true);
    reg(0xe000e014)=63999; reg(0xe000e018)=0; reg(0xe000e010)=7;
    asm volatile("cpsie i" ::: "memory");
    // Select the crystal oscillator for accurate UART timing.
    reg(0x40000100)=0; reg(0x40000000)=1;
    uint32_t start=ticks;
    while(!reg(0x40000100)) if(uint32_t(ticks-start)>1000) halt('X');
    output(6,true);
    reg(0x50000300+0x700+8*4)=12; // RX input with pull-up.
    reg(UART+0x500)=0; reg(UART+0x304)=0; reg(UART+0x308)=0xffffffff;
    reg(UART+0x200)=0; reg(UART+0x508)=0xffffffff; reg(UART+0x510)=0xffffffff;
    reg(UART+0x50c)=6; reg(UART+0x514)=40;
    reg(UART+0x56c)=0; reg(UART+0x524)=0x01d60000; reg(UART+0x480)=15;
    reg(UART+0x124)=0; reg(UART+0x500)=8; armRx();
}
bool baud(uint32_t value) {
    uint32_t setting;
    switch(value) {
        case 115200: setting=0x01d60000; break;
        case 230400: setting=0x03b00000; break;
        case 460800: setting=0x07400000; break;
        case 921600: setting=0x0f000000; break;
        case 1000000: setting=0x10000000; break;
        default: return false;
    }
    reg(UART+0x144)=0; reg(UART+4)=1;
    if(!wait(0x144)) return false;
    reg(UART+0x500)=0; reg(UART+0x524)=setting;
    reg(UART+0x480)=15; reg(UART+0x124)=0;
    reg(UART+0x500)=8; armRx(); return true;
}
bool receive(uint8_t *packet,bool initial) {
    uint32_t start=ticks; bool started=!initial;
    while(!reg(UART+0x110)) {
        if(reg(UART+0x124)) return false;
        if(!started && reg(UART+0x108)) { started=true; start=ticks; }
        if(started && uint32_t(ticks-start)>2000) return false;
    }
    if(reg(UART+0x124) || reg(UART+0x53c)!=64) return false;
    asm volatile("dmb" ::: "memory");
    memcpy(packet,rx,64); armRx(); return true;
}
bool send(const uint8_t *packet) {
    reg(UART+0x120)=0; reg(UART+0x158)=0;
    reg(UART+0x544)=uint32_t(packet); reg(UART+0x548)=64;
    reg(UART+8)=1;
    if(!wait(0x120)) return false;
    reg(UART+12)=1; return wait(0x158);
}
// nRF52 sleep can gate the processor clock used by SysTick. Keep it running;
// unlike CODAL we deliberately do not install an RTC/scheduler wake-up source.
void delay(unsigned ms) { uint32_t start=ticks; while(uint32_t(ticks-start)<ms) asm volatile("nop"); }
void display(char status) { glyph=status; }
uint32_t cycles() {
    // Debug-probe detach may clear TRCENA after startup; restore it for profiling.
    reg(0xe000edfc)|=1u<<24; reg(0xe0001000)|=1;
    return reg(0xe0001004);
}
extern "C" uint32_t __stack_limit, __stack_top;
unsigned stackUsed() { auto p=&__stack_limit; while(p<&__stack_top && *p==0xa5a5a5a5) ++p; return (&__stack_top-p)*4; }
[[noreturn]] void reset() { reg(0xe000ed0c)=0x05fa0004; asm volatile("dsb"); while(true) {} }
[[noreturn]] void halt(char status) { display(status); while(true) asm volatile("nop"); }
}
