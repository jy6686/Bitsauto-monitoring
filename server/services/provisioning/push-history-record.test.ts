import { describe, it, expect } from 'vitest';
import { buildProvisioningPushRow, summarise, PROVISIONING_PUSH_METHOD } from './push-history-record';

const rows = [
  { prefix: '19370', destinationName: 'AFGHANISTAN - MOBILE AWCC', productCode: 'FC' },
  { prefix: '19371', destinationName: 'AFGHANISTAN - MOBILE AWCC', productCode: 'FC' },
  { prefix: '19230', destinationName: 'PAKISTAN - MOBILE MOBILINK', productCode: 'FC' },
  { prefix: '29230', destinationName: 'PAKISTAN - MOBILE MOBILINK', productCode: 'BC' },
];
const base = {
  runId: 32, companyName: '1global', iTariff: 68, switchName: '191.101.30.107', rows,
  byProduct: [{ code: 'FC', count: 3 }, { code: 'BC', count: 1 }],
  message: 'Uploaded and verified (3/3 sampled, status DONE)', uploadStatus: 'DONE', verified: true,
  startedAt: new Date('2026-09-15T09:49:00Z'), finishedAt: new Date('2026-09-15T09:50:44Z'),
};

describe('buildProvisioningPushRow', () => {
  it('records a successful provisioning upload as its own source, never as a Rate Manager push', () => {
    const r = buildProvisioningPushRow({ ...base, outcome: 'completed' });
    expect(r.jobId).toBe('prov-32-rates');
    expect(r.pushMethod).toBe(PROVISIONING_PUSH_METHOD);
    expect(r.notificationType).toBeNull();
    expect(r.createdBy).toBe('provisioning');
    expect(r.clientNames).toBe('1global');
    expect(r.iTariff).toBe(68);
    expect(r.status).toBe('completed');
    expect([r.totalClients, r.pushedClients, r.failedClients]).toEqual([4, 4, 0]);
    expect(r.productName).toBe('FC 3 · BC 1');
    expect(r.destinationName).toBe('AFGHANISTAN - MOBILE AWCC, PAKISTAN - MOBILE MOBILINK');
    expect(r.fullPrefix).toBe('19370, 19371, 19230, 29230');
    expect(r.verificationResult).toBe('verified');
    expect(r.errorMessage).toBeNull();
    expect(r.notes).toMatch(/^Provisioning run #32: 4 row\(s\) across 2 destination\(s\) → tariff 68 — FC 3 · BC 1 — Uploaded and verified/);
    expect(r.effectiveAt).toBe('immediate');
  });

  it('a refused upload is failed with the refusal recorded; an unconfirmed one is needs_review', () => {
    const failed = buildProvisioningPushRow({ ...base, outcome: 'failed', verified: false, uploadStatus: 'FAIL', message: "Sippy's importer refused the upload" });
    expect(failed.status).toBe('failed');
    expect([failed.pushedClients, failed.failedClients]).toEqual([0, 4]);
    expect(failed.verificationResult).toBe('refused');
    expect(failed.errorMessage).toBe("Sippy's importer refused the upload");
    expect(failed.lastStep).toBe('failed');

    const unsure = buildProvisioningPushRow({ ...base, outcome: 'needs_review', verified: false, message: 'workbook sent, read-back did not confirm' });
    expect(unsure.status).toBe('needs_review');
    expect(unsure.verificationResult).toBe('unverified');
  });

  it('keeps every column inside its width, saying how many prefixes were left out', () => {
    const many = Array.from({ length: 60 }, (_, i) => ({ prefix: `192${String(i).padStart(3, '0')}`, destinationName: `DEST ${i}`, productCode: 'FC' }));
    const r = buildProvisioningPushRow({ ...base, rows: many, outcome: 'completed' });
    expect(String(r.fullPrefix).length).toBeLessThanOrEqual(32);
    expect(String(r.fullPrefix)).toMatch(/\+\d+$/);
    expect(String(r.dialPrefix).length).toBeLessThanOrEqual(128);
    expect(String(r.destinationName).length).toBeLessThanOrEqual(256);
    expect(r.notes).toMatch(/60 row\(s\) across 60 destination\(s\)/);
  });
});

describe('summarise', () => {
  it('joins whole items up to the limit and counts the rest', () => {
    expect(summarise(['a', 'b', 'c'], 32)).toBe('a, b, c');
    expect(summarise(['19370', '19371', '19230', '29230', '69230', '79230'], 20)).toBe('19370, 19371 +4');
    expect(summarise([], 32)).toBe('');
  });
});
