// Checks firestore.rules against the local emulator. Wipes the emulator's data first.
//   npx firebase-tools emulators:start --only auth,firestore
//   npm i @firebase/rules-unit-testing@3.0.4 firebase@10.12.2 && node tests/rules.test.mjs
import { readFileSync } from 'node:fs';
import { initializeTestEnvironment, assertSucceeds, assertFails } from '@firebase/rules-unit-testing';
import { doc, getDoc, setDoc, updateDoc, collection, query, where, getDocs, writeBatch, serverTimestamp } from 'firebase/firestore';

const rules = readFileSync(new URL('../firestore.rules', import.meta.url), 'utf8');
const env = await initializeTestEnvironment({ projectId: 'angaar-pizza-orders', firestore: { rules, host: '127.0.0.1', port: 8080 } });
await env.clearFirestore();

const pw = { firebase: { sign_in_provider: 'password' } }, anon = { firebase: { sign_in_provider: 'anonymous' } };
const owner = env.authenticatedContext('owner', pw).firestore();
const counter = env.authenticatedContext('counter', pw).firestore();
const offStaff = env.authenticatedContext('off', pw).firestore();
const stranger = env.authenticatedContext('stranger', pw).firestore();
const custCtx = n => env.authenticatedContext(n, anon).firestore();
const cust = custCtx('cust1'), cust2 = custCtx('cust2');
const nobody = env.unauthenticatedContext().firestore();

let pass = 0, fail = 0;
async function t(name, p) { try { await p; pass++; console.log('ok  ', name); } catch (e) { fail++; console.log('FAIL', name, '-', e.message.split('\n')[0]); } }

// Orders and requests go in a batch with the sender's spam-brake stamp, as the menu page does.
let n = 0;
function send(db, uid, data, kind = 'order', coll = 'orders') {
  const ref = doc(collection(db, coll)), b = writeBatch(db);
  b.set(doc(db, 'limits', uid + '_' + kind), { last: serverTimestamp() }); b.set(ref, data);
  return b.commit().then(() => ref);
}
const order = (uid, extra = {}) => ({ type: 'table', table: 2, name: '', phone: '', items: [{ n: 'Margherita', s: 'Regular', q: 1, p: 299, d: '', k: 'pizza', id: 'margherita', sz: 0, sauce: '', tops: {} }],
  total: 299, note: '', status: 'new', paid: false, uid, createdAt: serverTimestamp(), updatedAt: serverTimestamp(), ...extra });
const fresh = () => { const id = 'c' + (++n); return [custCtx(id), id]; };   // a new phone, so the 20 s brake does not interfere

// first set-up by the owner, in one batch
const b = writeBatch(owner);
b.set(doc(owner, 'staff/owner'), { name: 'O', email: 'o@x.test', role: 'admin', active: true, createdAt: serverTimestamp() });
b.set(doc(owner, 'config/shop'), { name: 'S', tables: 5, open: true, takeaway: true, upi: 'shop@okbank', payee: 'S', gstin: '', gst: 5, review: '', loyaltyEvery: 6 });
await t('owner can set up an empty shop', assertSucceeds(b.commit()));
const b2 = writeBatch(stranger);
b2.set(doc(stranger, 'staff/stranger'), { name: 'X', email: 'x@x.test', role: 'admin', active: true, createdAt: serverTimestamp() });
await t('nobody can make themselves owner once the shop exists', assertFails(b2.commit()));
await t('stranger cannot add themselves as counter', assertFails(setDoc(doc(stranger, 'staff/stranger'), { name: 'X', email: 'x', role: 'counter', active: true, createdAt: serverTimestamp() })));

await t('owner adds counter staff', assertSucceeds(setDoc(doc(owner, 'staff/counter'), { name: 'C', email: 'c@x.test', role: 'counter', active: true, createdAt: serverTimestamp() })));
await t('owner adds switched-off staff', assertSucceeds(setDoc(doc(owner, 'staff/off'), { name: 'F', email: 'f@x.test', role: 'counter', active: false, createdAt: serverTimestamp() })));
await t('owner writes the menu', assertSucceeds(setDoc(doc(owner, 'config/menu'), { soldOut: ['margherita'], prices: {} })));
await t('owner changes settings', assertSucceeds(updateDoc(doc(owner, 'config/shop'), { gst: 18, loyaltyEvery: 5 })));
await t('owner cannot set GST above 28%', assertFails(updateDoc(doc(owner, 'config/shop'), { gst: 40 })));
await t('counter cannot change settings', assertFails(updateDoc(doc(counter, 'config/shop'), { upi: 'thief@okbank' })));
await t('counter cannot write the menu', assertFails(setDoc(doc(counter, 'config/menu'), { soldOut: [], prices: {} })));
await t('counter cannot promote themselves', assertFails(updateDoc(doc(counter, 'staff/counter'), { role: 'admin' })));
await t('owner cannot switch themselves off', assertFails(updateDoc(doc(owner, 'staff/owner'), { active: false })));
await t('customer cannot read staff list', assertFails(getDocs(collection(cust, 'staff'))));
await t('anyone can read shop and menu', assertSucceeds(getDoc(doc(nobody, 'config/menu'))));

// ordering
let ref;
await t('customer places an order', assertSucceeds(send(cust, 'cust1', order('cust1')).then(r => (ref = r))));
await t('same phone cannot order again within 20 seconds', assertFails(send(cust, 'cust1', order('cust1'))));
{ const [c, id] = fresh(); const r = doc(collection(c, 'orders'));
  await t('order without the spam-brake stamp is refused', assertFails(setDoc(r, order(id)))); }
await t('signed-out visitor cannot order', assertFails(send(nobody, 'x', order('x'))));
{ const [c, id] = fresh(); await t('customer cannot order as someone else', assertFails(send(c, id, order('cust2')))); }
{ const [c, id] = fresh(); await t('customer cannot order for table 99', assertFails(send(c, id, order(id, { table: 99 })))); }
{ const [c, id] = fresh(); await t('customer cannot send an already-paid order', assertFails(send(c, id, order(id, { paid: true })))); }
{ const [c, id] = fresh(); await t('customer cannot skip to ready', assertFails(send(c, id, order(id, { status: 'ready' })))); }
{ const [c, id] = fresh(); await t('bad phone number is refused', assertFails(send(c, id, order(id, { phone: '12345' })))); }
{ const [c, id] = fresh(); await t('dine-in with a loyalty number works', assertSucceeds(send(c, id, order(id, { phone: '9876543210' })))); }
{ const [c, id] = fresh(); await t('takeaway with name and phone works', assertSucceeds(send(c, id, order(id, { type: 'takeaway', table: 0, name: 'Asha', phone: '9876543210' })))); }
{ const [c, id] = fresh(); await t('takeaway without a phone is refused', assertFails(send(c, id, order(id, { type: 'takeaway', table: 0, name: 'Asha', phone: '' })))); }
{ const [c, id] = fresh(); await t('takeaway for a table number is refused', assertFails(send(c, id, order(id, { type: 'takeaway', table: 3, name: 'Asha', phone: '9876543210' })))); }

await t('customer reads own orders', assertSucceeds(getDocs(query(collection(cust, 'orders'), where('uid', '==', 'cust1')))));
await t('customer cannot read all orders', assertFails(getDocs(collection(cust, 'orders'))));
await t('other customer cannot read this order', assertFails(getDoc(doc(cust2, 'orders', ref.id))));
await t('customer cannot mark own order paid', assertFails(updateDoc(doc(cust, 'orders', ref.id), { paid: true, updatedAt: serverTimestamp() })));
await t('customer cannot give themselves a discount', assertFails(updateDoc(doc(cust, 'orders', ref.id), { discount: 299, updatedAt: serverTimestamp() })));
await t('customer cannot rate before it is served', assertFails(updateDoc(doc(cust, 'orders', ref.id), { rating: 5, comment: '', updatedAt: serverTimestamp() })));
await t('switched-off staff cannot read orders', assertFails(getDocs(collection(offStaff, 'orders'))));
await t('counter reads all orders', assertSucceeds(getDocs(collection(counter, 'orders'))));
await t('counter cannot change the bill total', assertFails(updateDoc(doc(counter, 'orders', ref.id), { total: 1, updatedAt: serverTimestamp() })));
await t('counter accepts with a ready time', assertSucceeds(updateDoc(doc(counter, 'orders', ref.id), { status: 'accepted', eta: 15, acceptedAt: serverTimestamp(), updatedAt: serverTimestamp(), by: 'C' })));
await t('discount cannot exceed the total', assertFails(updateDoc(doc(counter, 'orders', ref.id), { discount: 500, updatedAt: serverTimestamp(), by: 'C' })));
await t('counter applies a free-pizza discount', assertSucceeds(updateDoc(doc(counter, 'orders', ref.id), { discount: 299, updatedAt: serverTimestamp(), by: 'C' })));
await t('customer cannot cancel once accepted', assertFails(updateDoc(doc(cust, 'orders', ref.id), { status: 'cancelled', updatedAt: serverTimestamp() })));
await t('counter marks it served and paid', assertSucceeds(updateDoc(doc(counter, 'orders', ref.id), { status: 'served', paid: true, stamps: 1, updatedAt: serverTimestamp(), by: 'C' })));
await t('customer rates a served order', assertSucceeds(updateDoc(doc(cust, 'orders', ref.id), { rating: 4, comment: 'Lovely crust', updatedAt: serverTimestamp() })));
await t('customer cannot rate twice', assertFails(updateDoc(doc(cust, 'orders', ref.id), { rating: 1, comment: '', updatedAt: serverTimestamp() })));
await t('rating must be 1 to 5', assertFails(updateDoc(doc(counter, 'orders', ref.id), { rating: 9, updatedAt: serverTimestamp() })));

// call staff / bring the bill
const req = uid => ({ table: 2, kind: 'bill', uid, done: false, createdAt: serverTimestamp() });
let rq;
await t('customer asks for the bill', assertSucceeds(send(cust, 'cust1', req('cust1'), 'req', 'requests').then(r => (rq = r))));
await t('second request within 20 seconds is refused', assertFails(send(cust, 'cust1', req('cust1'), 'req', 'requests')));
{ const [c, id] = fresh(); await t('request for a table that does not exist is refused', assertFails(send(c, id, { ...req(id), table: 50 }, 'req', 'requests'))); }
await t('customer cannot mark their request done', assertFails(updateDoc(doc(cust, 'requests', rq.id), { done: true })));
await t('counter sees requests', assertSucceeds(getDocs(query(collection(counter, 'requests'), where('done', '==', false)))));
await t('counter marks request done', assertSucceeds(updateDoc(doc(counter, 'requests', rq.id), { done: true, doneBy: 'C' })));

// loyalty records and bill numbers
await t('counter writes loyalty stamps', assertSucceeds(setDoc(doc(counter, 'customers/9876543210'), { name: 'Asha', stamps: 3, orders: 1, pizzas: 3, spent: 900 })));
await t('customer cannot read loyalty records', assertFails(getDoc(doc(cust, 'customers/9876543210'))));
await t('customer cannot give themselves stamps', assertFails(setDoc(doc(cust, 'customers/9000000000'), { stamps: 99 })));
await t('first bill number', assertSucceeds(setDoc(doc(counter, 'counters/bill'), { n: 1 })));
await t('bill numbers only go up by one', assertFails(setDoc(doc(counter, 'counters/bill'), { n: 7 })));
await t('next bill number', assertSucceeds(setDoc(doc(counter, 'counters/bill'), { n: 2 })));
await t('customer cannot touch bill numbers', assertFails(setDoc(doc(cust, 'counters/bill'), { n: 3 })));

await updateDoc(doc(owner, 'config/shop'), { open: false });
{ const [c, id] = fresh(); await t('no orders while the shop is closed', assertFails(send(c, id, order(id)))); }

console.log(`\n${pass} passed, ${fail} failed`);
await env.cleanup();
process.exit(fail ? 1 : 0);
