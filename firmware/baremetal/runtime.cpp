#include <stdint.h>
#include <stddef.h>
// Preserve the physical reset button when DAPLink erases/reprograms UICR.
__attribute__((section(".reset_config"),used)) const uint32_t resetPins[2]={18,18};
extern "C" {
void *memset(void *target,int value,size_t size) { auto p=(uint8_t*)target; while(size--) *p++=value; return target; }
void *memcpy(void *target,const void *source,size_t size) { auto d=(uint8_t*)target; auto s=(const uint8_t*)source; while(size--) *d++=*s++; return target; }
int memcmp(const void *a,const void *b,size_t size) { auto x=(const uint8_t*)a; auto y=(const uint8_t*)b; while(size--) { if(*x!=*y) return *x-*y; ++x; ++y; } return 0; }
extern void (*__init_start[])();
extern void (*__init_end[])();
int main();
void runtime_start() { for(auto p=__init_start;p!=__init_end;++p) (*p)(); main(); while(true) {} }
}
