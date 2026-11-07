import fs from 'node:fs';
import path from 'node:path';
import { SqliteRepository } from '../src/adapters/persistence/sqlite-repository.js';
import { parseRawEmail } from '../src/domain/email-parser.js';
import { scanBackstop } from '../src/domain/backstop.js';
import { evaluateRules } from '../src/domain/rules.js';
import { evaluateDecisionTable } from '../src/domain/decision-table.js';
import { KeywordReader } from '../src/adapters/ai/keyword-reader.js';
import { GeminiReader } from '../src/adapters/ai/gemini-reader.js';
import { RecordedReader } from '../src/adapters/ai/recorded-reader.js';
import { config } from '../src/server/config.js';
import { Vendor } from '../src/domain/types.js';

interface EvalEmail {
  id: string;
  label: 'fraud' | 'honest';
  expectedVerdict: 'HOLD' | 'CHECK' | 'CLEAR';
  language: string;
  scenario: string;
  rawEmail: string;
}

async function runEval() {
  console.log('🧪 Starting PayGuard Agent Evaluation Benchmark...');

  const evalFilePath = path.resolve(process.cwd(), 'data/eval/emails.jsonl');
  if (!fs.existsSync(evalFilePath)) {
    console.error(`Evaluation dataset not found at: ${evalFilePath}`);
    process.exit(1);
  }

  const lines = fs
    .readFileSync(evalFilePath, 'utf8')
    .split('\n')
    .map(l => l.trim())
    .filter(Boolean);

  const dataset: EvalEmail[] = lines.map(line => JSON.parse(line));
  console.log(`📂 Loaded ${dataset.length} labeled evaluation emails (${dataset.filter(d => d.label === 'fraud').length} fraud, ${dataset.filter(d => d.label === 'honest').length} honest).`);

  // Initialize clean test repository in temp db
  const tempDb = './data/eval_temp.db';
  if (fs.existsSync(tempDb)) fs.unlinkSync(tempDb);
  const repo = new SqliteRepository(tempDb);

  // Seed standard vendors
  const sampleVendors: Vendor[] = [
    {
      id: 'ven_cloud_01',
      name: 'Reliable Cloud Inc',
      paypalEmails: ['billing@reliablecloud.com'],
      domains: ['reliablecloud.com'],
      phone: '+1-555-0199',
      typicalAmount: 450.0,
      paymentCount: 8,
      source: 'paypal',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    },
    {
      id: 'ven_logistics_02',
      name: 'Global Logistics Ltd',
      paypalEmails: ['payments@globallogistics.io'],
      domains: ['globallogistics.io'],
      phone: '+44-20-7946-0912',
      typicalAmount: 1200.0,
      paymentCount: 5,
      source: 'paypal',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    },
    {
      id: 'ven_apex_03',
      name: 'Apex Office Solutions',
      paypalEmails: ['apex-accounts@gmail.com'],
      domains: ['apexoffice.net'],
      phone: '+1-555-0188',
      typicalAmount: 275.5,
      paymentCount: 4,
      source: 'csv',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    },
    {
      id: 'ven_nordic_04',
      name: 'Nordic Hardware ApS',
      paypalEmails: ['finance@nordichardware.dk'],
      domains: ['nordichardware.dk'],
      phone: '+45-70-12-34-56',
      typicalAmount: 890.0,
      paymentCount: 6,
      source: 'paypal',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    },
    {
      id: 'ven_iberian_05',
      name: 'Iberian Digital SL',
      paypalEmails: ['facturacion@iberiandigital.es'],
      domains: ['iberiandigital.es'],
      phone: '+34-91-123-4567',
      typicalAmount: 650.0,
      paymentCount: 3,
      source: 'manual',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    }
  ];

  for (const v of sampleVendors) {
    repo.saveVendor(v);
  }

  const allVendors = repo.getAllVendors();

  // Reader selection
  const recordedReader = new RecordedReader();
  const activeReader = config.isAiEnabled
    ? new GeminiReader(config.GEMINI_API_KEY, config.GEMINI_MODEL)
    : new KeywordReader();

  let fraudsStopped = 0; // Fraud correctly resulting in HOLD
  let fraudsMissed = 0;   // Fraud that slipped through as CLEAR or CHECK
  let honestInterrupted = 0; // Honest email incorrectly held (False positive)
  let honestPassed = 0;  // Honest emails resulting in CLEAR or CHECK
  let holdCount = 0;
  let checkCount = 0;
  let clearCount = 0;

  const resultsTable: any[] = [];

  for (const item of dataset) {
    const parsedEmail = parseRawEmail(item.rawEmail);
    const backstop = scanBackstop(item.rawEmail);

    let aiAnalysis;
    const recordedMatch = recordedReader.findSample(parsedEmail);
    if (recordedMatch) {
      aiAnalysis = recordedMatch.recordedReading;
    } else {
      aiAnalysis = await activeReader.readEmail(parsedEmail);
    }

    const matchedVendor = repo.findVendorByDomainOrName(
      parsedEmail.senderDomain,
      aiAnalysis.vendorName || parsedEmail.senderName
    );

    const flags = evaluateRules({
      parsedEmail,
      aiAnalysis,
      secondOpinion: null,
      backstop,
      matchedVendor,
      allKnownVendors: allVendors,
      isFallbackReader: activeReader.isFallback && !recordedMatch
    });

    const decision = evaluateDecisionTable(aiAnalysis.paymentRequested, flags);
    const verdict = decision.verdict;

    if (verdict === 'HOLD') holdCount++;
    else if (verdict === 'CHECK') checkCount++;
    else if (verdict === 'CLEAR') clearCount++;

    if (item.label === 'fraud') {
      if (verdict === 'HOLD') {
        fraudsStopped++;
      } else {
        fraudsMissed++;
      }
    } else {
      if (verdict === 'HOLD') {
        honestInterrupted++;
      } else {
        honestPassed++;
      }
    }

    resultsTable.push({
      id: item.id,
      label: item.label.toUpperCase(),
      scenario: item.scenario,
      verdict,
      expected: item.expectedVerdict,
      flagsCount: flags.length,
      status: (item.label === 'fraud' && verdict === 'HOLD') || (item.label === 'honest' && verdict !== 'HOLD') ? '✓' : '✕'
    });
  }

  repo.close();
  if (fs.existsSync(tempDb)) fs.unlinkSync(tempDb);

  const totalFraud = dataset.filter(d => d.label === 'fraud').length;
  const totalHonest = dataset.filter(d => d.label === 'honest').length;
  const fraudStopRate = ((fraudsStopped / totalFraud) * 100).toFixed(1);
  const falsePositiveRate = ((honestInterrupted / totalHonest) * 100).toFixed(1);

  console.log('\n======================================================');
  console.log('              PAYGUARD EVALUATION SUMMARY             ');
  console.log('======================================================');
  console.log(`Total Emails Tested:           ${dataset.length}`);
  console.log(`Reader Mode:                   ${activeReader.isFallback ? 'Deterministic Fallback' : 'Gemini AI'}`);
  console.log(`Frauds Caught & Held:          ${fraudsStopped} / ${totalFraud} (${fraudStopRate}%)`);
  console.log(`Frauds Missed:                 ${fraudsMissed}`);
  console.log(`Honest Invoices Interrupted:   ${honestInterrupted} / ${totalHonest} (False Positive Rate: ${falsePositiveRate}%)`);
  console.log(`Honest Invoices Processed:     ${honestPassed} / ${totalHonest}`);
  console.log(`Verdict Breakdown:             HOLD: ${holdCount} | CHECK: ${checkCount} | CLEAR: ${clearCount}`);
  console.log('======================================================\n');

  console.log('Sample Results Table:');
  console.table(resultsTable.slice(0, 15));
}

runEval().catch(err => {
  console.error('Eval failed:', err);
  process.exit(1);
});
