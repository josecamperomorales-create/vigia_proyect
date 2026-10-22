#include "../src/motion.h"
#include <cassert>
#include <cstdio>
int main(){
 MotionDetector m(100, 30, 20, 10);
 assert(m.update(99,true,true)==0 && !m.ready);
 assert(m.update(100,true,true)==1 && m.ready && !m.armed);
 assert(m.update(110,true,true)==0);
 assert(m.update(130,true,true)==0 && !m.armed); // HIGH cannot establish baseline
 assert(m.update(140,true,false)==0);
 assert(m.update(149,true,false)==0);
 assert(m.update(150,true,false)==4 && m.armed);
 assert(m.update(151,true,true)==0);
 assert(m.update(170,true,true)==0);
 assert(m.update(171,true,true)==2 && m.active);
 assert(m.update(172,true,false)==0);
 assert(m.update(180,true,true)==0 && m.active); // short LOW rejected
 assert(m.update(181,true,false)==0);
 assert(m.update(191,true,false)==3 && !m.active);
 assert(m.update(192,false,false)==0 && !m.armed);

 MotionDetector wrap(0,0,20,10);
 assert(wrap.update(0,false,false)==1);
 assert(wrap.update(0xfffffff0u,true,false)==0);
 assert(wrap.update(0xfffffff1u,true,false)==0);
 assert(wrap.update(0xfffffffbU,true,false)==4);
 assert(wrap.update(0xfffffffcU,true,true)==0);
 assert(wrap.update(17,true,true)==2);

 AlertGate gate(60);
 assert(gate.allow(100));
 assert(!gate.allow(159));
 assert(gate.allow(160));
 puts("PASS: warmup, clean baseline, confirmation, release, cooldown, timer wrap");
}
