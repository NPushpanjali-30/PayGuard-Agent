import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createMcpServer } from '../../src/mcp/server.js';
import { SqliteRepository } from '../../src/adapters/persistence/sqlite-repository.js';
import fs from 'node:fs';

describe('PayGuard MCP Server', () => {
  const testDb = './data/test_mcp.db';
  let repo: SqliteRepository;
  let client: Client;
  let serverTransport: InMemoryTransport;
  let clientTransport: InMemoryTransport;

  beforeEach(async () => {
    if (fs.existsSync(testDb)) {
      try {
        fs.unlinkSync(testDb);
      } catch {}
    }
    repo = new SqliteRepository(testDb);

    repo.saveVendor({
      id: 'v_cloud',
      name: 'Reliable Cloud Inc',
      paypalEmails: ['billing@reliablecloud.com'],
      domains: ['reliablecloud.com'],
      phone: '+1-555-0199',
      contactEmail: 'contact@reliablecloud.com',
      typicalAmount: 450.0,
      paymentCount: 8,
      source: 'manual',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    });

    const { server } = createMcpServer(repo);
    [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

    client = new Client(
      { name: 'test-client', version: '1.0.0' },
      { capabilities: {} }
    );

    await server.connect(serverTransport);
    await client.connect(clientTransport);
  });

  afterEach(async () => {
    await client.close();
    repo.close();
    if (fs.existsSync(testDb)) {
      try {
        fs.unlinkSync(testDb);
      } catch {}
    }
  });

  it('lists all 5 PayGuard security tools and enforces human-in-the-loop safety statements', async () => {
    const toolsResult = await client.listTools();
    const toolNames = toolsResult.tools.map(t => t.name);

    expect(toolNames).toContain('payguard_check_email');
    expect(toolNames).toContain('payguard_request_payment');
    expect(toolNames).toContain('payguard_list_pending');
    expect(toolNames).toContain('payguard_get_proposal');
    expect(toolNames).toContain('payguard_vendor_lookup');

    // Does NOT expose approve or pay
    expect(toolNames).not.toContain('payguard_approve_payment');
    expect(toolNames).not.toContain('payguard_pay');

    // Every tool description states safety principle
    for (const tool of toolsResult.tools) {
      expect(tool.description).toMatch(/human|approv|safety/i);
    }
  });

  it('calls payguard_check_email tool and returns security analysis without moving money', async () => {
    const rawEmail = `From: "Alice" <billing@reliablecloud.com>\nTo: ap@test.com\nSubject: Invoice #450\n\nPlease pay $450 to billing@reliablecloud.com.`;

    const res = await client.callTool({
      name: 'payguard_check_email',
      arguments: { rawEmail }
    });

    expect(res.content).toBeDefined();
    const parsed = JSON.parse((res.content as any)[0].text);
    expect(parsed.verdict).toBeDefined();
    expect(parsed.safetyNotice).toContain('Only humans approve');
  });

  it('calls payguard_request_payment and creates a proposal in PENDING_REVIEW (never executes payout)', async () => {
    const rawEmail = `From: "Alice" <billing@reliablecloud.com>\nTo: ap@test.com\nSubject: Routine Invoice #901\n\nServices rendered for $450.00. Payment to billing@reliablecloud.com.`;

    const res = await client.callTool({
      name: 'payguard_request_payment',
      arguments: { rawEmail }
    });

    const parsed = JSON.parse((res.content as any)[0].text);
    expect(parsed.proposalId).toBeDefined();
    expect(parsed.status).toBe('PENDING_REVIEW'); // Invariant: held in pending review!
    expect(parsed.payeeDestination).toBe('billing@reliablecloud.com');
    expect(parsed.safetyPrinciple).toContain('Payout execution is never exposed to AI agents');

    // Verify proposal is stored in repo with source: 'mcp'
    const proposal = repo.getProposalById(parsed.proposalId);
    expect(proposal?.source).toBe('mcp');
  });

  it('calls payguard_vendor_lookup tool to verify registered vendor info', async () => {
    const res = await client.callTool({
      name: 'payguard_vendor_lookup',
      arguments: { domain: 'reliablecloud.com' }
    });

    const parsed = JSON.parse((res.content as any)[0].text);
    expect(parsed.found).toBe(true);
    expect(parsed.vendor.name).toBe('Reliable Cloud Inc');
    expect(parsed.vendor.paypalEmails).toContain('billing@reliablecloud.com');
  });
});
