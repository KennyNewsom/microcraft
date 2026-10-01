#pragma once
#include <stdint.h>

namespace Platform {
void init();
bool baud(uint32_t value);
bool receive(uint8_t *packet, bool initial);
bool send(const uint8_t *packet);
void delay(unsigned ms);
void display(char status);
uint32_t cycles();
unsigned stackUsed();
[[noreturn]] void reset();
[[noreturn]] void halt(char status);
}
