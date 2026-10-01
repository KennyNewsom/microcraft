.syntax unified
.cpu cortex-m4
.thumb
.section .vectors,"a",%progbits
.global vectors
vectors:
  .word __stack_top
  .word Reset_Handler
  .rept 13
  .word Default_Handler
  .endr
  .word SysTick_Handler
  .rept 48
  .word Default_Handler
  .endr
.section .text.Reset_Handler,"ax",%progbits
.thumb_func
.global Reset_Handler
Reset_Handler:
  cpsid i
  ldr r0, =__data_load
  ldr r1, =__data_start
  ldr r2, =__data_end
1: cmp r1, r2
  bcs 2f
  ldr r3, [r0], #4
  str r3, [r1], #4
  b 1b
2: ldr r1, =__bss_start
  ldr r2, =__bss_end
  movs r3, #0
3: cmp r1, r2
  bcs 4f
  str r3, [r1], #4
  b 3b
4: ldr r1, =__stack_limit
  ldr r2, =__stack_top
  ldr r3, =0xa5a5a5a5
5: cmp r1, r2
  bcs 6f
  str r3, [r1], #4
  b 5b
6: bl runtime_start
  b .
.thumb_func
.global Default_Handler
Default_Handler:
  cpsid i
  b .
