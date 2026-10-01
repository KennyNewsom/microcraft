#include "MicroBit.h"
#include "Platform.h"
namespace Platform {
static MicroBit board;
void init() {
    board.init(); board.serial.setRxBufferSize(254); board.serial.setTxBufferSize(128);
    board.serial.setBaud(115200);
    CoreDebug->DEMCR |= CoreDebug_DEMCR_TRCENA_Msk;
    DWT->CYCCNT=0; DWT->CTRL |= DWT_CTRL_CYCCNTENA_Msk;
}
bool baud(uint32_t value) { return board.serial.setBaud(value)==DEVICE_OK; }
bool receive(uint8_t *packet,bool initial) {
    unsigned got=0; uint64_t start=system_timer_current_time();
    while(got<64) {
        int c=board.serial.read(ASYNC);
        if(c>=0) packet[got++]=c;
        else if(!got && initial) board.sleep(1);
        if((!initial || got) && system_timer_current_time()-start>2000) return false;
        if(initial && !got) start=system_timer_current_time();
    }
    return true;
}
bool send(const uint8_t *packet) { return board.serial.send(const_cast<uint8_t*>(packet),64,SYNC_SPINWAIT)==64; }
void delay(unsigned ms) { board.sleep(ms); }
void display(char status) { board.display.print(status); }
uint32_t cycles() { return DWT->CYCCNT; }
unsigned stackUsed() { return 0; }
[[noreturn]] void reset() { NVIC_SystemReset(); while(true) {} }
[[noreturn]] void halt(char status) { display(status); while(true) board.sleep(1000); }
}
