// sandbox/01-queues.js
// Run:  node sandbox/01-queues.js
//
// The event loop has more than one "later". This file schedules work four
// different ways, plus two plain synchronous logs. Each line is TAGGED with
// which queue it lands in — your job is to predict the ORDER the six letters
// print, BEFORE you run it. Write your guess down, then run and reconcile.
//
// The four "laters", roughly:
//   [sync]       runs now, in place
//   [next-tick]  process.nextTick — Node's own highest-priority defer queue
//   [microtask]  promise .then / queueMicrotask — the promise job queue
//   [timer]      setTimeout — a MACROtask; the event loop's next real turn

console.log('A  [sync]        top of file');

setTimeout(() => {
  console.log('B  [timer]       setTimeout(0)   — a MACROtask');
}, 0);

Promise.resolve().then(() => {
  console.log('C  [microtask]   promise .then');
});

queueMicrotask(() => {
  console.log('D  [microtask]   queueMicrotask');
});

process.nextTick(() => {
  console.log('E  [next-tick]   process.nextTick');
});

console.log('F  [sync]        bottom of file');

// Questions to answer from the output:
//   1. Do BOTH sync lines print before ANYTHING deferred? Why must they?
//   2. Of the deferred four, which runs first — and is that a Node rule or a
//      spec rule?
//   3. setTimeout(0) says "zero delay". Why does it still print LAST?
//   4. C and D are the same kind of queue. What decides C-before-D?
