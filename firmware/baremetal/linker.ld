ENTRY(Reset_Handler)
MEMORY {
  FLASH (rx) : ORIGIN = 0x00000000, LENGTH = 512K
  RAM (rwx) : ORIGIN = 0x20000000, LENGTH = 128K
  RESET_CONFIG (r) : ORIGIN = 0x10001200, LENGTH = 8
}
__stack_top = ORIGIN(RAM) + LENGTH(RAM);
__stack_limit = __stack_top - 8192;
SECTIONS {
  .vectors : { KEEP(*(.vectors)) } > FLASH
  .reset_config : { KEEP(*(.reset_config)) } > RESET_CONFIG
  .text : { *(.text*) *(.rodata*) . = ALIGN(4); } > FLASH
  .init_array : {
    __init_start = .; KEEP(*(SORT(.init_array.*))) KEEP(*(.init_array)) __init_end = .;
  } > FLASH
  .data : {
    . = ALIGN(4); __data_start = .; *(.data*) . = ALIGN(4); __data_end = .;
  } > RAM AT > FLASH
  __data_load = LOADADDR(.data);
  .bss (NOLOAD) : {
    . = ALIGN(4); __bss_start = .; *(.bss*) *(COMMON) . = ALIGN(4); __bss_end = .;
  } > RAM
  .stack __stack_limit (NOLOAD) : { . += 8192; } > RAM
  /DISCARD/ : { *(.ARM.exidx*) *(.ARM.extab*) *(.eh_frame*) *(.comment*) }
}
ASSERT(__bss_end <= __stack_limit, "Static RAM overlaps the reserved 8 KiB stack")
