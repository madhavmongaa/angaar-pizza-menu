// Checks firestore.rules against the local emulator. Wipes the emulator's data first.
//   npx firebase-tools emulators:start --only auth,firestore
//   npm i @firebase/rules-unit-testing@3.0.4 firebase@10.12.2 && node tests/rules.test.mjs
import { readFileSync } from 'node:fs';
import { initializeTestEnvironment, assertSucceeds, assertFails } from '@firebase/rules-unit-testing';
import { doc, getDoc, setDoc, updateDoc, addDoc, collection, query, where, getDocs, writeBatch, serverTimestamp } from 'firebase/firestore';

const rules = readFileSync(new URL('../firestore.rules', import.meta.url), 'utf8');
const env = await initializeTestEnvironment({ projectId: 'angaar-pizza-orders', firestore: { rules, host: '127.0.0.1', port: 8080 } });
await env.clearFirestore();

const pw = { firebase: { sign_in_provider: 'password' } }, anon = { firebase: { sign_in_provider: 'anonymous' } };
const owner = env.authenticatedContext('owner', pw).firestore();
const counter = env.authenticatedContext('counter', pw).firestore();
const offStaff = env.authenticatedContext('off', pw).firestore();
const stranger = env.authenticatedContext('stranger', pw).firestore();
const cust = env.authenticatedContext('cust1', anon).firestore();
const cust2 = env.authenticatedContext('cust2', anon).firestore();
const nobody = env.unauthenticatedContext().firestore();

let pass = 0, fail = 0;
async function t(name, p) { try { await p; pass++; console.log('ok  ', name); } catch (e) { fail++; console.log('FAIL', name, '-', e.message.split('\n')[0]); } }

// first set-up by the owner, in one batch
const b = writeBatch(owner);
b.set(doc(owner, 'staff/owner'), { name: 'O', email: 'o@x.test', role: 'admin', active: true, createdAt: serverTimestamp() });
b.set(doc(owner, 'config/shop'), { name: 'S', tables: 5, open: true });
await t('owner can set up an empty shop', assertSucceeds(b.commit()));
const b2 = writeBatch(stranger);
b2.set(doc(stranger, 'staff/stranger'), { name: 'X', email: 'x@x.test', role: 'admin', active: true, createdAt: serverTimestamp() });
await t('nobody can make themselves owner once the shop exists', assertFails(b2.commit()));
await t('stranger cannot add themselves as counter', assertFails(setDoc(doc(stranger, 'staff/stranger'), { name: 'X', email: 'x', role: 'counter', active: true, createdAt: serverTimestamp() })));

await t('owner adds counter staff', assertSucceeds(setDoc(doc(owner, 'staff/counter'), { name: 'C', email: 'c@x.test', role: 'counter', active: true, createdAt: serverTimestamp() })));
await t('owner adds switched-off staff', assertSucceeds(setDoc(doc(owner, 'staff/off'), { name: 'F', email: 'f@x.test', role: 'counter', active: false, createdAt: serverTimestamp() })));
await t('owner writes the menu', assertSucceeds(setDoc(doc(owner, 'config/menu'), { soldOut: ['margherita'], prices: {} })));
await t('counter cannot write the menu', assertFails(setDoc(doc(counter, 'config/menu'), { soldOut: [], prices: {} })));
await t('counter cannot change tables', assertFails(updateDoc(doc(counter, 'config/shop'), { tables: 50 })));
await t('counter cannot promote themselves', assertFails(updateDoc(doc(counter, 'staff/counter'), { role: 'admin' })));
await t('owner cannot switch themselves off', assertFails(updateDoc(doc(owner, 'staff/owner'), { active: false })));
await t('customer cannot read staff list', assertFails(getDocs(collection(cust, 'staff'))));
await t('anyone can read shop and menu', assertSucceeds(getDoc(doc(nobody, 'config/menu'))));

const order = uid => ({ table: 2, items: [{ n: 'Margherita', s: 'Regular', q: 1, p: 299, d: '' }], total: 299, note: '', status: 'new', paid: false, uid, createdAt: serverTimestamp(), updatedAt: serverTimestamp() });
let ref;
await t('customer places an order', assertSucceeds(addDoc(collection(cust, 'orders'), order('cust1')).then(r => (ref = r))));
await t('signed-out visitor cannot order', assertFails(addDoc(collection(nobody, 'orders'), order('x'))));
await t('customer cannot order as someone else', assertFails(addDoc(collection(cust, 'orders'), order('cust2'))));
await t('customer cannot order for table 99', assertFails(addDoc(collection(cust, 'orders'), { ...order('cust1'), table: 99 })));
await t('customer cannot send an already-paid order', assertFails(addDoc(collection(cust, 'orders'), { ...order('cust1'), paid: true })));
await t('customer cannot skip to ready', assertFails(addDoc(collection(cust, 'orders'), { ...order('cust1'), status: 'ready' })));
await t('customer reads own orders', assertSucceeds(getDocs(query(collection(cust, 'orders'), where('uid', '==', 'cust1')))));
await t('customer cannot read all orders', assertFails(getDocs(collection(cust, 'orders'))));
await t('other customer cannot read this order', assertFails(getDoc(doc(cust2, 'orders', ref.id))));
await t('customer cannot mark own order paid', assertFails(updateDoc(doc(cust, 'orders', ref.id), { paid: true, updatedAt: serverTimestamp() })));
await t('switched-off staff cannot read orders', assertFails(getDocs(collection(offStaff, 'orders'))));
await t('counter reads all orders', assertSucceeds(getDocs(collection(counter, 'orders'))));
await t('counter cannot change the bill total', assertFails(updateDoc(doc(counter, 'orders', ref.id), { total: 1, updatedAt: serverTimestamp() })));
await t('counter accepts the order', assertSucceeds(updateDoc(doc(counter, 'orders', ref.id), { status: 'accepted', updatedAt: serverTimestamp(), by: 'C' })));
await t('customer cannot cancel once accepted', assertFails(updateDoc(doc(cust, 'orders', ref.id), { status: 'cancelled', updatedAt: serverTimestamp() })));
await t('counter marks it paid', assertSucceeds(updateDoc(doc(counter, 'orders', ref.id), { paid: true, updatedAt: serverTimestamp(), by: 'C' })));

await updateDoc(doc(owner, 'config/shop'), { open: false });
await t('no orders while the shop is closed', assertFails(addDoc(collection(cust, 'orders'), order('cust1'))));

console.log(`\n${pass} passed, ${fail} failed`);
await env.cleanup();
process.exit(fail ? 1 : 0);
