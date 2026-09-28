#include "../src/motion.h"
#include <cassert>
#include <cstdio>
int main(){
 MotionDetector m;
 assert(m.update(100,true)==0 && !m.active);
 assert(m.update(59999,true)==0);
 assert(m.update(60000,true)==1);
 assert(m.update(60099,true)==0);
 assert(m.update(60100,true)==2 && m.active);
 assert(m.update(65000,true)==0);
 assert(m.update(65001,false)==0);
 assert(m.update(65050,true)==0);
 assert(m.update(65200,true)==0 && m.active);
 assert(m.update(65300,false)==0);
 assert(m.update(65400,false)==3 && !m.active);
 m.update(0xfffffff0u,true);
 assert(m.update(90,true)==2);
 puts("PASS: warmup, sustained signal, debounce, release, timer wrap");
}
