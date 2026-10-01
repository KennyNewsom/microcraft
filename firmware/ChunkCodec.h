#pragma once
#include <stdint.h>

// Lossless, bounded column/RLE/PackBits codec. No heap or full-chunk buffer.
// Frames carry an absolute decoded cursor, then a byte count and whole tokens.
struct ChunkCodec {
    uint16_t previous[128], current[128];
    unsigned cursor=0, column=~0u;
    void begin() { cursor=0; column=~0u; }
    template<class Source> void prepare(Source &source,unsigned slot) {
        unsigned next=cursor/128;
        if(column==next) return;
        if(column!=~0u) for(unsigned i=0;i<128;++i) previous[i]=current[i];
        column=next;
        for(unsigned i=0;i<128;++i) current[i]=source.get(slot,next*128+i);
    }
    bool same() const {
        if(!column) return false;
        for(unsigned i=0;i<128;++i) if(current[i]!=previous[i]) return false;
        return true;
    }
    unsigned run(unsigned offset) const {
        unsigned n=1;
        while(offset+n<128 && current[offset+n]==current[offset]) ++n;
        return n;
    }
    template<class Source> void encode(Source &source,unsigned slot,uint8_t *out) {
        unsigned used=0;
        for(unsigned i=0;i<48;++i) out[i]=0;
        while(cursor<32768) {
            prepare(source,slot);
            unsigned y=cursor%128, left=45-used;
            if(!y && same()) {
                if(left<2) break;
                unsigned count=0;
                do {
                    ++count; cursor+=128;
                    if(cursor==32768 || count==255) break;
                    prepare(source,slot);
                } while(same());
                out[3+used++]=2; out[3+used++]=count;
                continue;
            }
            unsigned n=run(y); uint16_t value=current[y];
            bool small=value<256;
            if(n>=3) {
                if(left<(small ? 3u : 4u)) break;
                out[3+used++]=small ? 3 : 1;
                out[3+used++]=n;
                out[3+used++]=value;
                if(!small) out[3+used++]=value>>8;
            } else {
                if(left<(small ? 3u : 4u)) break;
                unsigned max=(left-2)/(small ? 1 : 2); n=0;
                while(n<max && y+n<128 && (current[y+n]<256)==small) {
                    if(n && run(y+n)>=3) break;
                    ++n;
                }
                out[3+used++]=small ? 4 : 0; out[3+used++]=n;
                for(unsigned i=0;i<n;++i) {
                    value=current[y+i]; out[3+used++]=value;
                    if(!small) out[3+used++]=value>>8;
                }
            }
            cursor+=n;
        }
        out[0]=cursor; out[1]=cursor>>8; out[2]=used;
    }
};

// Saved edits: increasing index gaps and state IDs as canonical unsigned LEB128.
// Validate the entire frame before applying it to the authoritative cache.
inline bool editVarint(const uint8_t *p,unsigned length,unsigned &offset,unsigned &value) {
    value=0;
    for(unsigned shift=0;shift<=14;shift+=7) {
        if(offset>=length) return false;
        unsigned b=p[offset++]; value|=(b&127)<<shift;
        if(!(b&128)) return (!shift || b) && value<=65535;
    }
    return false;
}
inline bool decodeEdits(const uint8_t *p,uint16_t *indices,uint16_t *states,unsigned stateCount) {
    unsigned count=p[1],length=p[2],offset=0,next=0;
    if(!count || count>32 || length>45) return false;
    for(unsigned i=0;i<count;++i) {
        unsigned gap,value;
        if(!editVarint(p+3,length,offset,gap) || !editVarint(p+3,length,offset,value)) return false;
        unsigned index=next+gap;
        if(index>=32768 || value>=stateCount || (index%128==0 && value!=1)) return false;
        indices[i]=index; states[i]=value; next=index+1;
    }
    if(offset!=length) return false;
    for(unsigned i=3+length;i<48;++i) if(p[i]) return false;
    return true;
}
