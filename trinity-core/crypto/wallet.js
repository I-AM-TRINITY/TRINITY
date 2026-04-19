/**
 * Trinity SDK / Planespace / Trinity Core
 * Copyright (c) 2026 James Chapman (XheCarpenXer)
 *
 * Author: James Chapman
 * Alias: XheCarpenXer
 * Contact: xhecarpenxer@gmail.com
 *
 * SPDX-License-Identifier: AGPL-3.0-or-later
 *
 * This software is dual-licensed:
 * 1. Open Source License: GNU Affero General Public License v3.0 or later (AGPLv3+).
 * 2. Commercial / Government License: available for private, closed-source, warranty-backed,
 *    or separately negotiated terms beyond AGPL compliance.
 *
 * See: LICENSE, COMMERCIAL-LICENSE.md, FEE-SCHEDULE.md, CLA.md, LEGAL-NOTES.md
 * THIS SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND.
 */

/**
 * wallet.js — Trinity Native Wallet
 * ─────────────────────────────────────────────────────────────────────────────
 * Self-contained Ethereum-compatible wallet. Works in browser AND Node.js.
 * No MetaMask. No WalletConnect. No ethers.js. No CDN calls.
 *
 * Implements from scratch (pure JS / BigInt):
 *   • Keccak-256      — Ethereum hashing (NOT NIST SHA3 — different padding)
 *   • secp256k1       — Ethereum's elliptic curve
 *   • ECDSA sign / recover
 *   • EIP-191 personal_sign  (exact MetaMask format — works with existing server.js)
 *   • EIP-55 checksum addresses  (drop-in for ethers.getAddress)
 *   • AES-GCM encrypted key storage (WebCrypto — native in all modern browsers)
 *
 * Also computes on-chain hashes client-side:
 *   hashVoucherPassword("mySecret")
 *   → matches Solidity: keccak256(abi.encodePacked("mySecret"))
 *
 * Usage:
 *   <script src="wallet.js"></script>   → window.TrinityWallet
 *   const TW = require('./wallet.js')   → Node.js
 * ─────────────────────────────────────────────────────────────────────────────
 */
(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) module.exports = factory();
  else root.TrinityWallet = factory();
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  // ═══════════════════════════════════════════════════════════════════════════
  // § 1  UTILITY HELPERS
  // ═══════════════════════════════════════════════════════════════════════════

  const enc = new TextEncoder();

  const toHex   = b => Array.from(b).map(x => x.toString(16).padStart(2,'0')).join('');
  const fromHex = h => { h=h.replace(/^0x/,''); const b=new Uint8Array(h.length>>1); for(let i=0;i<b.length;i++) b[i]=parseInt(h.slice(i*2,i*2+2),16); return b; };
  const normalizePrivateKey = k => typeof k === 'string' ? fromHex(k) : k;
  const bigToBytes = (n,len) => fromHex(n.toString(16).padStart(len*2,'0'));
  const bytesToBig = b => BigInt('0x'+toHex(b));

  function randomBytes(n) {
    const b = new Uint8Array(n);
    const c = (typeof globalThis!=='undefined'&&globalThis.crypto)||(typeof window!=='undefined'&&window.crypto);
    if (c) { c.getRandomValues(b); return b; }
    require('crypto').randomFillSync(b); return b;
  }

  function getSubtle() {
    if (typeof globalThis!=='undefined'&&globalThis.crypto&&globalThis.crypto.subtle) return globalThis.crypto.subtle;
    if (typeof window!=='undefined'&&window.crypto&&window.crypto.subtle) return window.crypto.subtle;
    return require('crypto').webcrypto.subtle;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // § 2  KECCAK-256
  //   Original Keccak padding (0x01), NOT NIST SHA3 (0x06).
  //   Matches Solidity keccak256() and ethers.js keccak256().
  // ═══════════════════════════════════════════════════════════════════════════

  // 24 Keccak-f[1600] round constants as [lo32, hi32]
  const KC = [
    [0x00000001,0x00000000],[0x00008082,0x00000000],[0x0000808a,0x80000000],[0x80008000,0x80000000],
    [0x0000808b,0x00000000],[0x80000001,0x00000000],[0x80008081,0x80000000],[0x00008009,0x80000000],
    [0x0000008a,0x00000000],[0x00000088,0x00000000],[0x80008009,0x00000000],[0x8000000a,0x00000000],
    [0x8000808b,0x00000000],[0x0000008b,0x80000000],[0x00008089,0x80000000],[0x00008003,0x80000000],
    [0x00008002,0x80000000],[0x00000080,0x80000000],[0x0000800a,0x00000000],[0x8000000a,0x80000000],
    [0x80008081,0x80000000],[0x00008080,0x80000000],[0x80000001,0x00000000],[0x80008008,0x80000000],
  ];

  // ρ+π combined step: source lane, dest lane, rotation count
  // Derived from spec recurrence (x,y)←(y,(2x+3y)%5) starting at (1,0)
  const R_SRC = [1,10,7,11,17,18,3,5,16,8,21,24,4,15,23,19,13,12,2,20,14,22,9,6];
  const R_DST = [10,7,11,17,18,3,5,16,8,21,24,4,15,23,19,13,12,2,20,14,22,9,6,1];
  const R_ROT = [1,3,6,10,15,21,28,36,45,55,2,14,27,41,56,8,25,43,62,18,39,61,20,44];

  // 64-bit left-rotate on (lo32, hi32) pair
  function rLo(lo,hi,n){if(n===0)return lo>>>0;if(n<32)return((lo<<n)|(hi>>>(32-n)))>>>0;if(n===32)return hi>>>0;return((hi<<(n-32))|(lo>>>(64-n)))>>>0;}
  function rHi(lo,hi,n){if(n===0)return hi>>>0;if(n<32)return((hi<<n)|(lo>>>(32-n)))>>>0;if(n===32)return lo>>>0;return((lo<<(n-32))|(hi>>>(64-n)))>>>0;}

  function keccakF(s) {
    const b = new Uint32Array(50);
    for (let rd = 0; rd < 24; rd++) {
      // θ
      const c = new Uint32Array(10);
      for (let x=0;x<5;x++){c[2*x]=s[2*x]^s[2*(x+5)]^s[2*(x+10)]^s[2*(x+15)]^s[2*(x+20)];c[2*x+1]=s[2*x+1]^s[2*(x+5)+1]^s[2*(x+10)+1]^s[2*(x+15)+1]^s[2*(x+20)+1];}
      for (let x=0;x<5;x++){const px=(x+4)%5,nx=(x+1)%5,dl=c[2*px]^rLo(c[2*nx],c[2*nx+1],1),dh=c[2*px+1]^rHi(c[2*nx],c[2*nx+1],1);for(let y=0;y<5;y++){s[2*(x+5*y)]^=dl;s[2*(x+5*y)+1]^=dh;}}
      // ρ + π
      b[0]=s[0];b[1]=s[1];
      for (let i=0;i<24;i++){const src=R_SRC[i],dst=R_DST[i],rot=R_ROT[i];b[2*dst]=rLo(s[2*src],s[2*src+1],rot);b[2*dst+1]=rHi(s[2*src],s[2*src+1],rot);}
      // χ
      for (let y=0;y<5;y++)for(let x=0;x<5;x++){const i=x+5*y,n1=(x+1)%5+5*y,n2=(x+2)%5+5*y;s[2*i]=b[2*i]^(~b[2*n1]&b[2*n2]);s[2*i+1]=b[2*i+1]^(~b[2*n1+1]&b[2*n2+1]);}
      // ι
      s[0]^=KC[rd][0];s[1]^=KC[rd][1];
    }
  }

  /**
   * keccak256(data) → Uint8Array[32]
   * data: string | Uint8Array | ArrayBuffer
   *
   * String input: UTF-8 encoded — matches Solidity keccak256(abi.encodePacked(string))
   */
  function keccak256(data) {
    if (typeof data==='string') data=enc.encode(data);
    else if (!(data instanceof Uint8Array)) data=new Uint8Array(data);

    const rate=136; // 1088-bit rate for keccak-256
    const s=new Uint32Array(50);
    const plen=Math.ceil((data.length+1)/rate)*rate;
    const padded=new Uint8Array(plen);
    padded.set(data);
    padded[data.length]=0x01;          // Keccak padding (0x06 for NIST SHA3)
    padded[plen-1]|=0x80;

    for (let blk=0;blk<plen;blk+=rate){
      for(let j=0;j<34;j++){const o=blk+j*4;s[j]^=(padded[o]|(padded[o+1]<<8)|(padded[o+2]<<16)|(padded[o+3]<<24))>>>0;}
      keccakF(s);
    }

    const out=new Uint8Array(32);
    for(let j=0;j<8;j++){out[j*4]=s[j]&0xff;out[j*4+1]=(s[j]>>>8)&0xff;out[j*4+2]=(s[j]>>>16)&0xff;out[j*4+3]=(s[j]>>>24)&0xff;}
    return out;
  }

  const keccak256Hex = data => '0x'+toHex(keccak256(data));

  // ═══════════════════════════════════════════════════════════════════════════
  // § 3  secp256k1  (BigInt arithmetic)
  // ═══════════════════════════════════════════════════════════════════════════

  const P  = BigInt('0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEFFFFFC2F');
  const N  = BigInt('0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEBAAEDCE6AF48A03BBFD25E8CD0364141');
  const Gx = BigInt('0x79BE667EF9DCBBAC55A06295CE870B07029BFCDB2DCE28D959F2815B16F81798');
  const Gy = BigInt('0x483ADA7726A3C4655DA4FBFC0E1108A8FD17B448A68554199C47D08FFB10D4B8');
  const G  = [Gx, Gy];

  const fmod  = (a,m) => ((a%m)+m)%m;
  const fmul  = (a,b,m) => a*b%m;

  function modpow(base,exp,m){let r=1n;base=fmod(base,m);while(exp>0n){if(exp&1n)r=r*base%m;base=base*base%m;exp>>=1n;}return r;}

  function modinv(a,m){a=fmod(a,m);let[or,r]=[a,m],[os,s]=[1n,0n];while(r!==0n){const q=or/r;[or,r]=[r,or-q*r];[os,s]=[s,os-q*s];}return fmod(os,m);}

  function ptAdd(P1,P2){
    if(!P1)return P2;if(!P2)return P1;
    const[x1,y1]=P1,[x2,y2]=P2;
    if(x1===x2){if(y1!==y2)return null;const lam=3n*x1*x1%P*modinv(2n*y1,P)%P,x3=fmod(lam*lam-2n*x1,P);return[x3,fmod(lam*(x1-x3)-y1,P)];}
    const lam=fmod(y2-y1,P)*modinv(fmod(x2-x1,P),P)%P,x3=fmod(lam*lam-x1-x2,P);return[x3,fmod(lam*(x1-x3)-y1,P)];
  }

  function ptMul(k,pt){let r=null,cur=pt;while(k>0n){if(k&1n)r=ptAdd(r,cur);cur=ptAdd(cur,cur);k>>=1n;}return r;}

  function privToPublicBytes(priv){
    const[x,y]=ptMul(bytesToBig(priv),G);
    const pub=new Uint8Array(65);pub[0]=0x04;pub.set(bigToBytes(x,32),1);pub.set(bigToBytes(y,32),33);return pub;
  }

  function pubKeyToAddress(pub){return'0x'+toHex(keccak256(pub.slice(1)).slice(12));}

  // ─── ECDSA sign ──────────────────────────────────────────────────────────

  function ecdsaSign(hash32, privKey) {
    const d=bytesToBig(privKey), z=bytesToBig(hash32);
    let r,s,v;
    while(true){
      const k=bytesToBig(randomBytes(32));
      if(k===0n||k>=N)continue;
      const R=ptMul(k,G);if(!R)continue;
      r=R[0]%N;if(r===0n)continue;
      s=modinv(k,N)*(z+r*d)%N;if(s===0n)continue;
      v=Number(R[1]%2n);
      if(s>N/2n){s=N-s;v^=1;}   // low-s normalisation (EIP-2)
      break;
    }
    return{r,s,v};
  }

  // ─── ECDSA recover ───────────────────────────────────────────────────────

  function ecRecover(hash32, r, s, v) {
    const y2=fmod(r*r*r+7n,P);
    let y=modpow(y2,(P+1n)/4n,P);        // works because P ≡ 3 mod 4
    if(Number(y%2n)!==v) y=P-y;
    const R=[r,y];
    const z=bytesToBig(hash32), rInv=modinv(r,N);
    const Q=ptAdd(ptMul(fmod(-z*rInv,N),G),ptMul(s*rInv%N,R));
    if(!Q){
      console.error('[wallet.js] ECDSA recovery failed: point addition returned null');
      return null;
    }
    const pub=new Uint8Array(65);pub[0]=0x04;pub.set(bigToBytes(Q[0],32),1);pub.set(bigToBytes(Q[1],32),33);
    return checksumAddress(pubKeyToAddress(pub));
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // § 4  ETHEREUM AUTH HELPERS
  // ═══════════════════════════════════════════════════════════════════════════

  function personalSignHash(message){
    const mb=typeof message==='string'?enc.encode(message):message;
    const pre=enc.encode('\x19Ethereum Signed Message:\n'+mb.length);
    const all=new Uint8Array(pre.length+mb.length);all.set(pre);all.set(mb,pre.length);
    return keccak256(all);
  }

  /** personalSign — exact MetaMask output. Compatible with existing server.js */
  function personalSign(message, privKey) {
    const keyBytes=normalizePrivateKey(privKey);
    const{r,s,v}=ecdsaSign(personalSignHash(message),keyBytes);
    const sig=new Uint8Array(65);sig.set(bigToBytes(r,32));sig.set(bigToBytes(s,32),32);sig[64]=v+27;
    return'0x'+toHex(sig);
  }

  /** personalRecover — mirrors ethers.verifyMessage() */
  function personalRecover(message, signature) {
    const sb=fromHex(signature);
    return ecRecover(personalSignHash(message),bytesToBig(sb.slice(0,32)),bytesToBig(sb.slice(32,64)),sb[64]-27);
  }

  /** checksumAddress — mirrors ethers.getAddress() */
  function checksumAddress(addr){
    if (!addr || typeof addr !== 'string') {
      throw new Error('Address must be a non-empty string');
    }
    addr=addr.toLowerCase().replace('0x','');
    if(!/^[0-9a-f]{40}$/.test(addr)) {
      throw new Error(`Invalid address format: expected 40 hex chars, got "${addr}"`);
    }
    const h=toHex(keccak256(enc.encode(addr)));
    let out='0x';for(let i=0;i<40;i++)out+=parseInt(h[i],16)>=8?addr[i].toUpperCase():addr[i];
    return out;
  }

  /** normalizeAddress — drop-in for ethers.getAddress() used in server.js */
  function normalizeAddress(value){
    try{
      if(!value)return null;
      const addr=String(value).trim().replace('0x','').toLowerCase();
      if(!/^[0-9a-f]{40}$/.test(addr)) {
        console.warn(`[wallet.js] Invalid address format: ${value}`);
        return null;
      }
      return checksumAddress('0x'+addr);
    } catch(err){
      console.error(`[wallet.js] normalizeAddress error: ${err.message}`);
      return null;
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // § 5  VOUCHER HASH  (matches on-chain Solidity keccak256)
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * hashVoucherPassword(password) → "0x<64 hex chars>"
   *
   * Matches: keccak256(abi.encodePacked(password)) in PhysicalTokenTransfer.sol
   * Use this client-side to compute passwordHash before calling depositETH / depositERC20.
   * Never send the plaintext password over the network.
   */
  function hashVoucherPassword(password) {
    return '0x'+toHex(keccak256(enc.encode(password)));
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // § 6  WALLET MANAGEMENT
  // ═══════════════════════════════════════════════════════════════════════════

  const STORE_KEY = 'trinity_native_wallet_v1';

  function generateWallet(){
    let priv;do{priv=randomBytes(32);}while(bytesToBig(priv)===0n||bytesToBig(priv)>=N);
    const pub=privToPublicBytes(priv);
    return{privateKey:priv,address:checksumAddress(pubKeyToAddress(pub))};
  }

  function importWallet(hex){
    const priv=typeof hex==='string'?fromHex(hex):hex;
    const privBig=bytesToBig(priv);
    
    if(privBig===0n || privBig>=N){
      throw new Error('Invalid private key: must be in range [1, N-1]');
    }
    
    return{privateKey:priv,address:checksumAddress(pubKeyToAddress(privToPublicBytes(priv)))};
  }

  async function _encryptKey(priv,password){
    const subtle=getSubtle(),salt=randomBytes(16),iv=randomBytes(12);
    const km=await subtle.importKey('raw',enc.encode(password),'PBKDF2',false,['deriveKey']);
    const ak=await subtle.deriveKey({name:'PBKDF2',salt,iterations:200000,hash:'SHA-256'},km,{name:'AES-GCM',length:256},false,['encrypt']);
    const ct=await subtle.encrypt({name:'AES-GCM',iv},ak,priv);
    return{v:1,salt:toHex(salt),iv:toHex(iv),ct:toHex(new Uint8Array(ct))};
  }

  async function _decryptKey(rec,password){
    try {
      const subtle=getSubtle();
      if (!rec.salt || !rec.iv || !rec.ct) {
        throw new Error('Missing decryption parameters (salt/iv/ct)');
      }
      const km=await subtle.importKey('raw',enc.encode(password),'PBKDF2',false,['deriveKey']);
      const ak=await subtle.deriveKey({name:'PBKDF2',salt:fromHex(rec.salt),iterations:200000,hash:'SHA-256'},km,{name:'AES-GCM',length:256},false,['decrypt']);
      const pt=await subtle.decrypt({name:'AES-GCM',iv:fromHex(rec.iv)},ak,fromHex(rec.ct));
      return new Uint8Array(pt);
    } catch (err) {
      throw new Error(`Wallet decryption failed: ${err.message}`);
    }
  }

  // encryptKey / decryptKey: public wrappers used by index.html native wallet modal
  async function encryptKey(priv, password) {
    return _encryptKey(priv, password);
  }

  async function decryptKey(encrypted, password) {
    return _decryptKey(encrypted, password);
  }

  // generate / fromPrivateKey / fromMnemonic: aliases used by index.html
  function generate() { return generateWallet(); }
  function fromPrivateKey(hex) { return importWallet(hex); }
  function generateKeypairSync() {
    const wallet = generateWallet();
    return { address: wallet.address, privateKey: '0x' + toHex(wallet.privateKey) };
  }
  function generateWalletSync() {
    const wallet = generateWallet();
    return { address: wallet.address, keyHex: '0x' + toHex(wallet.privateKey) };
  }
  async function sign(message, privateKeyHex) {
    return personalSign(message, privateKeyHex);
  }
  function recoverAddress(message, signature) {
    return personalRecover(message, signature);
  }
  // fromMnemonic: not implemented — wallet.js uses raw private keys only
  async function fromMnemonic() {
    throw new Error('Mnemonic import is not supported. Please import using a private key (0x…).');
  }

  async function saveWallet(priv, password) {
    const keyBytes = normalizePrivateKey(priv);
    const address = checksumAddress(pubKeyToAddress(privToPublicBytes(keyBytes)));
    let rec;
    if (password) {
      const encrypted = await _encryptKey(keyBytes, password);
      rec = { address, encrypted, createdAt: Date.now() };
    } else {
      rec = { address, key: toHex(keyBytes), createdAt: Date.now() }; // ⚠ dev only
    }
    if (typeof localStorage !== 'undefined') localStorage.setItem(STORE_KEY, JSON.stringify(rec));
    return rec;
  }

  async function loadWallet(password) {
    const raw = typeof localStorage !== 'undefined' ? localStorage.getItem(STORE_KEY) : null;
    if (!raw) return null;
    try {
      const rec = JSON.parse(raw);
      // New format: { address, encrypted: {v,salt,iv,ct} }
      if (rec.encrypted && typeof rec.encrypted === 'object') {
        if (!password) throw new Error('Password required for encrypted wallet');
        const priv = await _decryptKey(rec.encrypted, password);
        return { privateKey: priv, address: rec.address };
      }
      // Legacy flat format: { encrypted: true, address, v, salt, iv, ct }
      if (rec.encrypted === true && rec.salt) {
        if (!password) throw new Error('Password required for encrypted wallet');
        const priv = await _decryptKey(rec, password);
        return { privateKey: priv, address: rec.address };
      }
      // Unencrypted dev key
      if (rec.key) return { privateKey: fromHex(rec.key), address: rec.address };
      throw new Error('Unrecognized wallet record format');
    } catch (err) {
      console.error(`[wallet.js] loadWallet error: ${err.message}`);
      throw err;
    }
  }

  const hasWallet     = ()=>typeof localStorage!=='undefined'&&Boolean(localStorage.getItem(STORE_KEY));
  const forgetWallet  = ()=>typeof localStorage!=='undefined'&&localStorage.removeItem(STORE_KEY);
  const storedAddress = ()=>{const r=typeof localStorage!=='undefined'?localStorage.getItem(STORE_KEY):null;return r?JSON.parse(r).address:null;};

  // ═══════════════════════════════════════════════════════════════════════════
  // § 7  PUBLIC API
  // ═══════════════════════════════════════════════════════════════════════════

  return {
    // Hashing
    keccak256,           // Uint8Array → Uint8Array
    keccak256Hex,        // any → "0x..."
    hashVoucherPassword, // string → "0x..." (matches Solidity)

    // Address
    checksumAddress,     // "0x..." → EIP-55 checksummed
    normalizeAddress,    // replaces ethers.getAddress() in server.js

    // Signing  (exact MetaMask / ethers.js format — server.js unchanged)
    personalSign,        // (message, privKey) → "0x..."
    personalRecover,     // (message, signature) → address
    sign,                // formal interface alias for personalSign
    recoverAddress,      // formal interface alias for personalRecover

    // Wallet lifecycle — canonical names
    generateWallet,      // () → { privateKey, address }
    generateKeypairSync, // () → { address, privateKey: "0x..." }
    generateWalletSync,  // () → { address, keyHex: "0x..." }
    importWallet,        // (hexOrBytes) → { privateKey, address }
    saveWallet,          // async (priv, password?) → record
    loadWallet,          // async (password?) → { privateKey, address }
    hasWallet,           // () → bool
    forgetWallet,        // () → void
    storedAddress,       // () → address | null

    // Wallet lifecycle — index.html aliases
    generate,            // alias for generateWallet
    fromPrivateKey,      // alias for importWallet
    fromMnemonic,        // throws helpful error (not implemented)
    encryptKey,          // async (priv, password) → {v,salt,iv,ct}
    decryptKey,          // async (encrypted, password) → Uint8Array

    // Low-level
    ecdsaSign,
    ecRecover,
    privToPublicBytes,
    pubKeyToAddress,
    toHex,
    fromHex,
  };
}));
