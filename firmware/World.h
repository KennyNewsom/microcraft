#pragma once
#include <stdint.h>
#include <string.h>

// Procedural chunks retain only edits. No heap or PC-side terrain generation.
struct World {
    static const unsigned HEIGHT = 128, SLOTS = 100, CAPACITY = 4096;
    static const uint32_t EMPTY = 0xffffffffu, DELETED = 0xfffffffeu;
    static const uint32_t KEY_MASK = 0x003fffffu;
    struct Chunk { int32_t x, z; bool active, dirty; } chunks[SLOTS];
    uint32_t keys[CAPACITY];
    uint8_t values[CAPACITY];
    uint32_t seed;
    unsigned used;
    uint8_t changed[13];
    World() : seed(0x4d435246), used(0) {
        memset(chunks, 0, sizeof(chunks));
        memset(keys, 255, sizeof(keys));
        clearChanges();
    }
    static int32_t floorDiv(int32_t x, int32_t n) { return x / n - (x % n < 0); }
    static uint32_t hash(uint32_t x) {
        x ^= x >> 16; x *= 0x7feb352du; x ^= x >> 15; x *= 0x846ca68bu; return x ^ (x >> 16);
    }
    uint32_t noise(int32_t x, int32_t z) const { return hash(uint32_t(x)*0x9e3779b9u ^ uint32_t(z)*0x85ebca6bu ^ seed); }
    int height(int32_t x, int32_t z) const {
        // Preserve the old spawn area's exact flat baseline and blend outward.
        int dx = x < 0 ? -x : x > 31 ? x-31 : 0;
        int dz = z < 0 ? -z : z > 31 ? z-31 : 0;
        int distance = dx > dz ? dx : dz;
        int32_t gx=floorDiv(x,32), gz=floorDiv(z,32);
        int fx=x-gx*32, fz=z-gz*32;
        int a=noise(gx,gz)%28, b=noise(gx+1,gz)%28;
        int c=noise(gx,gz+1)%28, d=noise(gx+1,gz+1)%28;
        int h=12+((a*(32-fx)+b*fx)*(32-fz)+(c*(32-fx)+d*fx)*fz)/1024;
        return 7+(h-7)*(distance < 48 ? distance : 48)/48;
    }
    uint8_t base(unsigned slot, unsigned index) const {
        int y=index%HEIGHT, column=index/HEIGHT;
        int32_t x=chunks[slot].x*16+column%16, z=chunks[slot].z*16+column/16;
        if (y==0) return 1;
        int h=height(x,z);
        if (y>h) return 0;
        if (y==h) return 3;
        if (y>=h-3 || (x>=0 && x<32 && z>=0 && z<32)) return 2;
        // Sparse deterministic ore veins under the surface.
        uint32_t ore=noise(floorDiv(x,3),floorDiv(z,3)) ^ hash(y/3+seed);
        if (ore%59==0) return 225; // coal_ore, append-only palette
        return 4;
    }
    unsigned locate(uint32_t key, bool insert=false) const {
        unsigned start=hash(key)&(CAPACITY-1), tomb=CAPACITY;
        for(unsigned n=0;n<CAPACITY;n++) {
            unsigned i=(start+n)&(CAPACITY-1);
            if(keys[i]<DELETED && (keys[i]&KEY_MASK)==key) return i;
            if(keys[i]==DELETED && tomb==CAPACITY) tomb=i;
            if(keys[i]==EMPTY) return insert && tomb!=CAPACITY ? tomb : i;
        }
        return insert ? tomb : CAPACITY;
    }
    uint16_t stored(unsigned i) const { return values[i] | ((keys[i]>>22)<<8); }
    uint16_t get(unsigned slot,unsigned index) const {
        uint32_t key=(slot<<15)|index; unsigned i=locate(key);
        return i<CAPACITY && keys[i]<DELETED && (keys[i]&KEY_MASK)==key ? stored(i) : base(slot,index);
    }
    void erase(unsigned hole) {
        // Back-shift deletion: repeated travel must not fill the table with tombstones.
        unsigned next=(hole+1)&(CAPACITY-1);
        while(keys[next]!=EMPTY) {
            unsigned home=hash(keys[next]&KEY_MASK)&(CAPACITY-1);
            if(((next-home)&(CAPACITY-1))>=((hole-home)&(CAPACITY-1))) {
                keys[hole]=keys[next]; values[hole]=values[next]; hole=next;
            }
            next=(next+1)&(CAPACITY-1);
        }
        keys[hole]=EMPTY; --used;
    }
    bool set(unsigned slot,unsigned index,uint16_t value,bool dirty=true) {
        uint32_t key=(slot<<15)|index; unsigned i=locate(key,true);
        bool exists=i<CAPACITY && keys[i]<DELETED && (keys[i]&KEY_MASK)==key;
        if(get(slot,index)==value) return true;
        if(value==base(slot,index)) {
            if(exists) erase(i);
        } else {
            if(!exists && (used>=CAPACITY*3/4 || i==CAPACITY)) return false;
            if(!exists) ++used;
            keys[i]=key | (uint32_t(value>>8)<<22); values[i]=value;
        }
        if(dirty) { chunks[slot].dirty=true; changed[slot/8]|=1u<<(slot%8); }
        return true;
    }
    void unload(unsigned slot) {
        for(unsigned i=0;i<CAPACITY;i++) while(keys[i]<DELETED && ((keys[i]&KEY_MASK)>>15)==slot) erase(i);
        chunks[slot].active=false; chunks[slot].dirty=false;
        if(!used) memset(keys,255,sizeof(keys));
    }
    int find(int32_t x,int32_t z) const {
        for(unsigned s=0;s<SLOTS;s++) if(chunks[s].active && chunks[s].x==x && chunks[s].z==z) return s;
        return -1;
    }
    void clearChanges() { memset(changed,0,sizeof(changed)); }
    int slotAt(int x,int y,int z) const {
        if(y<0 || y>=128 || x < -1000000 || x>=1000000 || z < -1000000 || z>=1000000) return -1;
        return find(floorDiv(x,16),floorDiv(z,16));
    }
    unsigned indexAt(int x,int y,int z) const { return ((z-floorDiv(z,16)*16)*16+x-floorDiv(x,16)*16)*128+y; }
    uint16_t at(int x,int y,int z) const { int s=slotAt(x,y,z); return s<0 ? 0 : get(s,indexAt(x,y,z)); }
    bool put(int x,int y,int z,uint16_t value) { int s=slotAt(x,y,z); return s>=0 && y>0 && set(s,indexAt(x,y,z),value); }
    void position(unsigned i,int &x,int &y,int &z) const {
        uint32_t key=keys[i]&KEY_MASK; unsigned s=key>>15,index=key&32767;
        x=chunks[s].x*16+(index/128)%16; y=index%128; z=chunks[s].z*16+index/(128*16);
    }
};
