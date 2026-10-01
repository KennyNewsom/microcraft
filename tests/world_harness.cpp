#include "../firmware/World.h"
#include "../firmware/Gameplay.h"
#include "../firmware/ChunkCodec.h"
#include <new>
extern "C" void *memset(void *p,int v,unsigned n) { auto b=(uint8_t*)p; while(n--) *b++=v; return p; }
static World world;
extern "C" void init_world() { new (&world) World(); }
extern "C" unsigned world_size() { return sizeof(world); }
extern "C" void load_chunk(unsigned s,int x,int z) { world.chunks[s]={x,z,true,false}; }
extern "C" unsigned get_block(unsigned s,unsigned i) { return world.get(s,i); }
extern "C" unsigned set_block(unsigned s,unsigned i,unsigned v) { return world.set(s,i,v); }
extern "C" void unload_chunk(unsigned s) { world.unload(s); }
extern "C" unsigned used_edits() { return world.used; }
extern "C" int divide(int x,int n) { return World::floorDiv(x,n); }
static int face=1,yaw=0,hit=128,sneak=0;
extern "C" void options(int f,int a,int h,int s) { face=f; yaw=a; hit=h; sneak=s; }
extern "C" unsigned place(int x,int y,int z,unsigned item) { uint8_t reason; Gameplay g(world); return g.edit(x,y,z,item,1,face,yaw,hit,128,128,sneak,reason) ? 1 : reason+1; }
extern "C" unsigned remove_block(int x,int y,int z) { uint8_t reason; Gameplay g(world); return g.edit(x,y,z,0,2,1,0,128,128,128,false,reason); }
extern "C" void settle() { Gameplay g(world); g.settle(); }
extern "C" unsigned at(int x,int y,int z) { return world.at(x,y,z); }
extern "C" unsigned put(int x,int y,int z,unsigned value) { return world.put(x,y,z,value); }
static ChunkCodec codec;
static unsigned codecSlot,fixtureKind;
extern "C" uint8_t codecPacket[48];
uint8_t codecPacket[48];
struct Fixture {
    uint16_t get(unsigned,unsigned i) {
        if(fixtureKind==1) return 3065;
        if(fixtureKind==2) return (i%128)%2 ? 3684 : 255;
        uint32_t v=i*2654435761u; v^=v>>13; return v%STATE_COUNT;
    }
};
extern "C" void codec_begin(unsigned slot,unsigned fixture) { codecSlot=slot; fixtureKind=fixture; codec.begin(); }
extern "C" unsigned codec_next() {
    Fixture fixture;
    if(fixtureKind) codec.encode(fixture,codecSlot,codecPacket); else codec.encode(world,codecSlot,codecPacket);
    return codec.cursor;
}
extern "C" unsigned chunk_checksum(unsigned slot) {
    unsigned sum=0;
    for(unsigned i=0;i<32768;++i) sum=sum*33+world.get(slot,i);
    return sum;
}
extern "C" unsigned decode_edit_test() {
    uint16_t indices[32],states[32];
    if(!decodeEdits(codecPacket,indices,states,STATE_COUNT)) return 0;
    for(unsigned i=0;i<codecPacket[1];++i) if(!world.set(codecPacket[0],indices[i],states[i],false)) return 0;
    return 1;
}
