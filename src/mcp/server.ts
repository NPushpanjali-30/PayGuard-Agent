import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { config } from '../server/config.js';
import { SqliteRepository } from '../adapters/persistence/sqlite-repository.js';
import { IRepository } from '../application/ports/repository.js';
import { CheckEmailUseCase } from '../application/use-cases/check-email.js';
import { GeminiReader } from '../adapters/ai/gemini-reader.js';
import { KeywordReader } from '../adapters/ai/keyword-reader.js';
import { GeminiJudge } from '../adapters/ai/gemini-judge.js';
import { GeminiInvoiceReader } from '../adapters/ai/gemini-invoice-reader.js';
import { FallbackInvoiceReader } from '../adapters/ai/fallback-invoice-reader.js';

export function createMcpServer(customRepo?: IRepository) {
  const repository = customRepo || new SqliteRepository(config.DB_PATH);

  const emailReader = config.isAiEnabled
    ? new GeminiReader(config.GEMINI_API_KEY, config.GEMINI_MODEL)
    : new KeywordReader();

  const secondOpinionJudge = config.isAiEnabled
    ? new GeminiJudge(config.GEMINI_API_KEY, config.GEMINI_MODEL)
    : null;

  const invoiceReader = config.isAiEnabled
    ? new GeminiInvoiceReader(config.GEMINI_API_KEY, config.GEMINI_MODEL)
    : new FallbackInvoiceReader();

  const checkEmailUseCase = new CheckEmailUseCase(
    repository,
    emailReader,
    secondOpinionJudge,
    invoiceReader
  );

  const server = new Server(
    {
      name: 'payguard-agent-mcp',
      version: '1.0.0'
    },
    {
      capabilities: {
        tools: {}
      }
    }
  );

  // List Available Tools
  server.setRequestHandler(ListToolsRequestSchema, async () => {
    return {
      tools: [
        {
          name: 'payguard_check_email',
          description:
            'Analyzes raw email text for Business Email Compromise (BEC), payee redirection fraud, and suspicious invoice claims against PayPal records. Returns verdict (HOLD, CHECK, CLEAR) and flags. SAFETY PRINCIPLE: Only humans approve payments in the PayGuard web app; this tool never authorizes disbursements.',
          inputSchema: {
            type: 'object',
            properties: {
              rawEmail: {
                type: 'string',
                description: 'The raw text content of the incoming invoice or payment request email'
              }
            },
            required: ['rawEmail']
          }
        },
        {
          name: 'payguard_request_payment',
          description:
            'Creates a pending payment proposal for an invoice from an email. SAFETY PRINCIPLE: This tool NEVER executes a payout. Payout execution is never exposed to agents. It strictly registers a proposal held for human review and dual-approval in the PayGuard web dashboard.',
          inputSchema: {
            type: 'object',
            properties: {
              rawEmail: {
                type: 'string',
                description: 'The raw email text requesting payment'
              }
            },
            required: ['rawEmail']
          }
        },
        {
          name: 'payguard_list_pending',
          description:
            'Lists payment proposals currently in PENDING_REVIEW status awaiting human approver authorization. SAFETY PRINCIPLE: AI agents cannot approve or release payments.',
          inputSchema: {
            type: 'object',
            properties: {}
          }
        },
        {
          name: 'payguard_get_proposal',
          description:
            'Fetches the current lifecycle status and security details of a payment proposal by ID. SAFETY PRINCIPLE: Payout execution is never exposed to agents; only humans approve in the web app.',
          inputSchema: {
            type: 'object',
            properties: {
              proposalId: {
                type: 'string',
                description: 'The ID of the proposal to inspect (e.g. prop_...)'
              }
            },
            required: ['proposalId']
          }
        },
        {
          name: 'payguard_vendor_lookup',
          description:
            'Looks up verified vendor payment records on file by name or domain. Helps agents verify whether a recipient address or domain is authentic before requesting payment. SAFETY PRINCIPLE: AI agents cannot modify payment destinations.',
          inputSchema: {
            type: 'object',
            properties: {
              domain: {
                type: 'string',
                description: 'Vendor domain (e.g. reliablecloud.com)'
              },
              name: {
                type: 'string',
                description: 'Vendor company name (e.g. Reliable Cloud Inc)'
              }
            }
          }
        }
      ]
    };
  });

  // Call Tools Handler
  server.setRequestHandler(CallToolRequestSchema, async request => {
    const { name, arguments: args } = request.params;

    try {
      switch (name) {
        case 'payguard_check_email': {
          const rawEmail = String(args?.rawEmail || '');
          if (!rawEmail || rawEmail.trim().length === 0) {
            throw new Error("Missing required argument 'rawEmail'");
          }

          const result = await checkEmailUseCase.execute({
            rawEmail,
            actor: 'mcp_agent',
            source: 'mcp',
            policyConfig: {
              approvalLimit: config.APPROVAL_LIMIT,
              hardLimit: config.HARD_LIMIT,
              dualApprovalThreshold: config.DUAL_APPROVAL_THRESHOLD,
              coolingOffHours: config.NEW_PAYEE_COOLING_OFF_HOURS
            }
          });

          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify(
                  {
                    verdict: result.verdict,
                    verdictSummary: result.verdictSummary,
                    flags: result.flags,
                    proposalId: result.proposal ? result.proposal.id : null,
                    vendorName: result.proposal ? result.proposal.vendorName : null,
                    amount: result.proposal ? result.proposal.amount : null,
                    payee: result.proposal ? result.proposal.payee : null,
                    safetyNotice:
                      'Only humans approve payments in the PayGuard web app. This check did not disburse funds.'
                  },
                  null,
                  2
                )
              }
            ]
          };
        }

        case 'payguard_request_payment': {
          const rawEmail = String(args?.rawEmail || '');
          if (!rawEmail || rawEmail.trim().length === 0) {
            throw new Error("Missing required argument 'rawEmail'");
          }

          const result = await checkEmailUseCase.execute({
            rawEmail,
            actor: 'mcp_agent',
            source: 'mcp',
            policyConfig: {
              approvalLimit: config.APPROVAL_LIMIT,
              hardLimit: config.HARD_LIMIT,
              dualApprovalThreshold: config.DUAL_APPROVAL_THRESHOLD,
              coolingOffHours: config.NEW_PAYEE_COOLING_OFF_HOURS
            }
          });

          if (!result.proposal) {
            return {
              content: [
                {
                  type: 'text',
                  text: JSON.stringify({
                    created: false,
                    reason: 'No payment requested in email or amount could not be determined.',
                    verdict: result.verdict
                  })
                }
              ]
            };
          }

          const p = result.proposal;
          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify(
                  {
                    proposalId: p.id,
                    status: p.status,
                    verdict: p.verdict,
                    vendorName: p.vendorName,
                    amount: p.amount,
                    currency: p.currency,
                    payeeDestination: p.payee,
                    requiresDualApproval: p.requiresDualApproval,
                    dashboardUrl: `${config.APP_BASE_URL}/proposals/${p.id}`,
                    safetyPrinciple:
                      'Proposal created in PENDING_REVIEW. Payout execution is never exposed to AI agents; a human must approve in the web app.'
                  },
                  null,
                  2
                )
              }
            ]
          };
        }

        case 'payguard_list_pending': {
          const allProposals = repository.getAllProposals();
          const pending = allProposals.filter(p => p.status === 'PENDING_REVIEW');

          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify(
                  {
                    pendingCount: pending.length,
                    proposals: pending.map(p => ({
                      id: p.id,
                      vendorName: p.vendorName,
                      amount: p.amount,
                      currency: p.currency,
                      payee: p.payee,
                      verdict: p.verdict,
                      source: p.source,
                      requiresDualApproval: p.requiresDualApproval,
                      firstApprover: p.firstApprover,
                      createdAt: p.createdAt,
                      dashboardUrl: `${config.APP_BASE_URL}/proposals/${p.id}`
                    }))
                  },
                  null,
                  2
                )
              }
            ]
          };
        }

        case 'payguard_get_proposal': {
          const proposalId = String(args?.proposalId || '');
          if (!proposalId) {
            throw new Error("Missing required argument 'proposalId'");
          }

          const proposal = repository.getProposalById(proposalId);
          if (!proposal) {
            return {
              isError: true,
              content: [
                {
                  type: 'text',
                  text: `Proposal with ID '${proposalId}' not found.`
                }
              ]
            };
          }

          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify(
                  {
                    id: proposal.id,
                    status: proposal.status,
                    verdict: proposal.verdict,
                    vendorName: proposal.vendorName,
                    amount: proposal.amount,
                    currency: proposal.currency,
                    payee: proposal.payee,
                    source: proposal.source,
                    flags: proposal.flags,
                    requiresDualApproval: proposal.requiresDualApproval,
                    firstApprover: proposal.firstApprover,
                    secondApprover: proposal.secondApprover,
                    coolingOffUntil: proposal.coolingOffUntil,
                    paypalBatchId: proposal.paypalBatchId,
                    createdAt: proposal.createdAt,
                    dashboardUrl: `${config.APP_BASE_URL}/proposals/${proposal.id}`
                  },
                  null,
                  2
                )
              }
            ]
          };
        }

        case 'payguard_vendor_lookup': {
          const domain = args?.domain ? String(args.domain) : undefined;
          const name = args?.name ? String(args.name) : undefined;

          if (!domain && !name) {
            throw new Error("Must provide at least 'domain' or 'name' for vendor lookup.");
          }

          const vendor = repository.findVendorByDomainOrName(domain || '', name);
          if (!vendor) {
            return {
              content: [
                {
                  type: 'text',
                  text: JSON.stringify({
                    found: false,
                    message: 'No registered vendor found matching query.'
                  })
                }
              ]
            };
          }

          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify(
                  {
                    found: true,
                    vendor: {
                      id: vendor.id,
                      name: vendor.name,
                      paypalEmails: vendor.paypalEmails,
                      domains: vendor.domains,
                      phone: vendor.phone,
                      contactEmail: vendor.contactEmail,
                      typicalAmount: vendor.typicalAmount,
                      paymentCount: vendor.paymentCount
                    }
                  },
                  null,
                  2
                )
              }
            ]
          };
        }

        default:
          throw new Error(`Unknown MCP tool: ${name}`);
      }
    } catch (err: any) {
      return {
        isError: true,
        content: [
          {
            type: 'text',
            text: `Tool execution failed: ${err.message}`
          }
        ]
      };
    }
  });

  return { server, repository, checkEmailUseCase };
}

// Run server over stdio if executed directly
async function main() {
  const { server } = createMcpServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('🚀 PayGuard Agent MCP Server running on stdio');
}

// Auto-run if main module
if (process.argv[1] && process.argv[1].replace(/\\/g, '/').endsWith('src/mcp/server.ts')) {
  main().catch(err => {
    console.error('Fatal error in MCP server:', err);
    process.exit(1);
  });
}
