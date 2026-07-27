#!/usr/bin/env node
// ينسخ js/*.js إلى public/js/*.js ويتحقق إنهم متطابقين بايت-لبايت بعد النسخ.
// الهدف: يقفل فجوة النشر المتكررة (نسيان تحديث public/js يدويًا قبل wrangler deploy)
// اللي سببت 3 حوادث موثّقة (LOT 3 NEW، BOX-138+، TM) قبل هذا الملف.
//
// الاستخدام:
//   node scripts/sync-public.js          — ينسخ كل الملفات المختلفة ويتحقق
//   node scripts/sync-public.js --check  — يتحقق بس (بدون نسخ)، exit code 1 لو في اختلاف

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const SRC_DIR = path.join(ROOT, 'js');
const DEST_DIR = path.join(ROOT, 'public', 'js');
const checkOnly = process.argv.includes('--check');

const files = fs.readdirSync(SRC_DIR).filter(f => f.endsWith('.js'));
if (!files.length) {
  console.error(`لا يوجد ملفات .js في ${SRC_DIR}`);
  process.exit(1);
}

let copied = 0, upToDate = 0, mismatched = 0, missing = 0;

for (const f of files) {
  const srcPath = path.join(SRC_DIR, f);
  const destPath = path.join(DEST_DIR, f);
  const srcContent = fs.readFileSync(srcPath);

  let destContent = null;
  if (fs.existsSync(destPath)) destContent = fs.readFileSync(destPath);

  if (destContent !== null && Buffer.compare(srcContent, destContent) === 0) {
    upToDate++;
    continue;
  }

  if (destContent === null) {
    missing++;
    console.log(`${checkOnly ? '[ناقص] ' : '[نسخ جديد] '}${f}`);
  } else {
    mismatched++;
    console.log(`${checkOnly ? '[مختلف] ' : '[تحديث] '}${f}`);
  }

  if (!checkOnly) {
    fs.mkdirSync(path.dirname(destPath), { recursive: true });
    fs.writeFileSync(destPath, srcContent);
    const verify = fs.readFileSync(destPath);
    if (Buffer.compare(srcContent, verify) !== 0) {
      console.error(`  ✗ فشل التحقق بعد النسخ: ${f}`);
      process.exit(1);
    }
    copied++;
  }
}

console.log('');
if (checkOnly) {
  console.log(`مطابق: ${upToDate} | مختلف: ${mismatched} | ناقص: ${missing}`);
  if (mismatched || missing) {
    console.error('✗ public/js غير متطابق مع js — شغّل بدون --check للنسخ');
    process.exit(1);
  }
  console.log('✓ public/js مطابق لـ js بالكامل');
} else {
  console.log(`مطابق أصلًا: ${upToDate} | تم نسخه/تحديثه: ${copied}`);
  console.log('✓ public/js متطابق الآن مع js بايت-لبايت (تم التحقق من كل ملف)');
}
