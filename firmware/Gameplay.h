#pragma once
#include "World.h"
#include "States.h"

// All placement, interaction, shape and power decisions remain on the MCU.
// Redstone is an immediate, bounded local circuit model, not vanilla tick timing.
struct Gameplay {
    World &w;
    Gameplay(World &world):w(world) {}
    static const BlockGroup *group(uint16_t value) {
        if(value<255) return nullptr;
        unsigned lo=0,hi=sizeof(GROUPS)/sizeof(GROUPS[0]);
        while(lo<hi) { unsigned mid=(lo+hi)/2; const auto &g=GROUPS[mid];
            if(value<g.start) hi=mid; else if(value>=g.start+g.count) lo=mid+1; else return &g;
        }
        return nullptr;
    }
    static int kind(uint16_t v) { const auto g=group(v); return g ? g->kind : 0; }
    static int dx(int f) { return f==1 ? 1 : f==3 ? -1 : 0; }
    static int dz(int f) { return f==2 ? 1 : f==0 ? -1 : 0; }
    bool solid(int x,int y,int z) const {
        uint16_t v=w.at(x,y,z); const auto g=group(v);
        return v && (!g || g->kind==7 || (g->kind==3 && v-g->start==2));
    }
    int wireNeighbor(int x,int y,int z,int f,int &ny) const {
        int nx=x+dx(f),nz=z+dz(f); ny=y;
        if(kind(w.at(nx,y,nz))==6) return 1;
        if(solid(nx,y,nz) && !solid(x,y+1,z) && kind(w.at(nx,y+1,nz))==6) { ny=y+1; return 2; }
        if(!solid(nx,y,nz) && kind(w.at(nx,y-1,nz))==6) { ny=y-1; return 1; }
        return 0;
    }
    int source(int x,int y,int z,bool wires=true) const {
        uint16_t v=w.at(x,y,z); if(v==REDSTONE_BLOCK) return 15;
        const auto g=group(v); if(!g) return 0;
        if(g->kind==5 && v-g->start>=12) return 15;
        return wires && g->kind==6 ? (v-g->start)%16 : 0;
    }
    int power(int x,int y,int z,bool wires=true) const {
        int best=0;
        for(int f=0;f<6;f++) {
            int p=f<4 ? source(x+dx(f),y,z+dz(f),wires) : source(x,y+(f==4 ? 1 : -1),z,wires);
            if(p>best) best=p;
        }
        return best;
    }
    bool sameStair(int x,int y,int z,int face,int half) const {
        uint16_t v=w.at(x,y,z); const auto g=group(v);
        return g && g->kind==4 && ((v-g->start)&7)==(face|half);
    }
    int stairShape(int x,int y,int z,int face,int half) const {
        uint16_t v=w.at(x+dx(face),y,z+dz(face)); const auto front=group(v);
        if(front && front->kind==4 && ((v-front->start)&4)==half) {
            int f=(v-front->start)&3;
            if((f&1)!=(face&1) && !sameStair(x-dx(f),y,z-dz(f),face,half)) return f==((face+3)&3) ? 3 : 4;
        }
        v=w.at(x-dx(face),y,z-dz(face)); const auto back=group(v);
        if(back && back->kind==4 && ((v-back->start)&4)==half) {
            int f=(v-back->start)&3;
            if((f&1)!=(face&1) && !sameStair(x+dx(f),y,z+dz(f),face,half)) return f==((face+3)&3) ? 1 : 2;
        }
        return 0;
    }
    void settle() {
        // Remove unsupported fixtures and incomplete doors. Deletion back-shifts
        // the hash table, so revisit that slot rather than skipping its replacement.
        for(unsigned i=0;i<World::CAPACITY;i++) if(w.keys[i]<World::DELETED) {
            uint16_t v=w.stored(i); const auto g=group(v); if(!g) continue;
            int x,y,z; w.position(i,x,y,z); int b=v-g->start; bool supported=true;
            if(g->kind==1) {
                uint16_t mate=w.at(x,y+(b&8 ? -1 : 1),z);
                supported=group(mate)==g && ((mate-g->start)&8)!=(b&8) && solid(x,y-((b&8) ? 2 : 1),z);
            } else if(g->kind==6) supported=solid(x,y-1,z);
            else if(g->kind==5) {
                int mount=(b%12)>>2,face=b&3;
                supported=mount==0 ? solid(x,y-1,z) : mount==2 ? solid(x,y+1,z) :
                    (w.slotAt(x-dx(face),y,z-dz(face))<0 || solid(x-dx(face),y,z-dz(face)));
            }
            if(!supported) { w.put(x,y,z,0); --i; }
        }
        // Clear existing wire power first so source removal cannot leave a loop
        // self-powered. At most fifteen attenuation steps can carry power.
        for(unsigned i=0;i<World::CAPACITY;i++) if(w.keys[i]<World::DELETED) {
            uint16_t v=w.stored(i); const auto g=group(v); if(!g || g->kind!=6) continue;
            int x,y,z; w.position(i,x,y,z); w.put(x,y,z,v-(v-g->start)%16);
        }
        for(int pass=0;pass<16;pass++) {
            bool changed=false;
            for(unsigned i=0;i<World::CAPACITY;i++) if(w.keys[i]<World::DELETED) {
                uint16_t v=w.stored(i); const auto g=group(v); if(!g || g->kind!=6) continue;
                int x,y,z; w.position(i,x,y,z); int p=power(x,y,z,false);
                for(int f=0;f<4;f++) { int ny; if(wireNeighbor(x,y,z,f,ny)) { int n=source(x+dx(f),ny,z+dz(f))-1; if(n>p) p=n; } }
                if(p>(v-g->start)%16) { w.put(x,y,z,v-(v-g->start)%16+p); changed=true; }
            }
            if(!changed) break;
        }
        for(unsigned i=0;i<World::CAPACITY;i++) if(w.keys[i]<World::DELETED) {
            uint16_t v=w.stored(i); const auto g=group(v); if(!g) continue;
            int x,y,z; w.position(i,x,y,z); int b=v-g->start,next=b;
            if(g->kind==4) next=(b&7)+8*stairShape(x,y,z,b&3,b&4);
            else if(g->kind==6) {
                int connections=0,multiplier=1,sides[4],count=0;
                for(int f=0;f<4;f++) {
                    int ny; sides[f]=wireNeighbor(x,y,z,f,ny);
                    int neighborKind=kind(w.at(x+dx(f),y,z+dz(f)));
                    if(!sides[f] && (neighborKind==5 || w.at(x+dx(f),y,z+dz(f))==REDSTONE_BLOCK)) sides[f]=1;
                    if(sides[f]) ++count;
                }
                if(!count) for(int f=0;f<4;f++) sides[f]=1;
                else if(count==1) for(int f=0;f<4;f++) if(sides[f]) { sides[(f+2)&3]=1; break; }
                for(int f=0;f<4;f++) { connections+=sides[f]*multiplier; multiplier*=3; }
                next=b%16+connections*16;
            } else if(g->kind==7) next=power(x,y,z)>0;
            else if(g->kind==1 && !(b&8)) {
                bool powered=power(x,y,z)>0 || power(x,y+1,z)>0;
                if(powered!=bool(b&32)) next=(b&~36)|(powered ? 36 : 0);
                w.put(x,y+1,z,g->start+(next|8));
            } else if(g->kind==2) {
                bool powered=power(x,y,z)>0;
                if(powered!=bool(b&16)) next=(b&~20)|(powered ? 20 : 0);
            }
            if(next!=b) w.put(x,y,z,g->start+next);
        }
    }
    // Coordinates refer to the clicked block; return the actual edited position.
    // action 0 is a raw edit for diagnostics, 1 use/place, 2 creative break.
    bool edit(int &x,int &y,int &z,uint16_t item,int action,int face,int yaw,int hitY,int hitX,int hitZ,bool sneak,uint8_t &reason) {
        reason=1;
        if(y<0 || (y==0 && action!=1) || w.slotAt(x,y,z)<0) return false;
        uint16_t current=w.at(x,y,z); auto old=group(current); int bits=old ? current-old->start : 0;
        if(action==2) {
            if(!w.put(x,y,z,0)) { reason=2; return false; }
            if(old && old->kind==1) { int mateY=y+(bits&8 ? -1 : 1); if(group(w.at(x,mateY,z))==old) w.put(x,mateY,z,0); }
            reason=0; settle(); return true;
        }
        if(action==1 && old && !sneak) {
            if(old->kind==5 || ((old->kind==1 || old->kind==2) && old->manual)) {
                int next=old->kind==5 ? (bits+12)%24 : bits^4;
                if(old->kind==1) { if(bits&8) --y; next&=~8; w.put(x,y+1,z,old->start+(next|8)); }
                w.put(x,y,z,old->start+next); reason=0; settle(); return true;
            }
        }
        if(item>=STATE_COUNT) return false;
        const auto g=group(item);
        if(action==1) {
            if(face<0 || face>5) return false;
            // Merge a matching slab when clicking its exposed half.
            bool merge=old && old==g && old->kind==3 && bits<2 &&
                ((bits==0 && face==1) || (bits==1 && face==0) || (face>=2 && ((bits==0 && hitY>=128)||(bits==1 && hitY<128))));
            if(!merge) {
                if(face<2) y+=face==0 ? -1 : 1;
                else { const int f=face==2 ? 0 : face==3 ? 2 : face==4 ? 3 : 1; x+=dx(f); z+=dz(f); }
                if(y<=0 || w.slotAt(x,y,z)<0) return false;
                current=w.at(x,y,z); old=group(current); bits=old ? current-old->start : 0;
                merge=old && old==g && old->kind==3 && bits<2;
            }
            if(merge) item=g->start+2;
            else {
                if(current!=0) return false;
                int f=((yaw+32)/64+2)&3;
                if(g) {
                    if(g->kind==1) {
                        if(y>=127 || w.at(x,y+1,z)!=0 || !solid(x,y-1,z)) return false;
                        int right=(f+1)&3;
                        bool hinge=right==1 ? hitX>=128 : right==3 ? hitX<128 : right==2 ? hitZ>=128 : hitZ<128;
                        item=g->start+f+(hinge ? 16 : 0);
                    } else if(g->kind==2) {
                        if(face>=2) f=face==2 ? 0 : face==3 ? 2 : face==4 ? 3 : 1;
                        item=g->start+f+((face==0 || (face>=2 && hitY>=128)) ? 8 : 0);
                    } else if(g->kind==3) item=g->start+((face==0 || (face>=2 && hitY>=128)) ? 1 : 0);
                    else if(g->kind==4) item=g->start+f+((face==0 || (face>=2 && hitY>=128)) ? 4 : 0);
                    else if(g->kind==5) {
                        if(face>=2) f=face==2 ? 0 : face==3 ? 2 : face==4 ? 3 : 1;
                        item=g->start+f+(face==0 ? 8 : face==1 ? 0 : 4);
                    } else if(g->kind==6 && !solid(x,y-1,z)) return false;
                }
            }
        }
        // A two-block door is committed only when both edit entries fit.
        unsigned needed=0; int cells=(g && g->kind==1 && action==1) ? 2 : 1;
        for(int n=0;n<cells;n++) {
            int slot=w.slotAt(x,y+n,z); if(slot<0) return false;
            unsigned index=w.indexAt(x,y+n,z),i=w.locate((slot<<15)|index);
            if((i>=World::CAPACITY || w.keys[i]>=World::DELETED) && w.base(slot,index)!=(n ? item+8 : item)) ++needed;
        }
        if(w.used+needed>World::CAPACITY*3/4) { reason=2; return false; }
        if(!w.put(x,y,z,item)) { reason=2; return false; }
        if(cells==2) w.put(x,y+1,z,item+8);
        reason=0; settle(); return true;
    }
};
