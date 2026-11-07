import { EmailAIAnalysis, SecondOpinion } from '../../domain/types.js';

export interface SampleEmailItem {
  id: string;
  title: string;
  category: 'fraud' | 'honest';
  label: string;
  rawEmail: string;
  recordedReading: EmailAIAnalysis;
  recordedSecondOpinion: SecondOpinion;
}

export const SAMPLE_EMAILS: SampleEmailItem[] = [
  {
    id: 'sample-fraud-new-payee',
    title: 'Fraud: Payee Redirect / Bank Change',
    category: 'fraud',
    label: 'Fraud: New Payee',
    rawEmail: `From: "Alice Martin" <billing@reliablecloud.com>
To: accounting@mybusiness.com
Subject: Invoice #8841 - Updated Remittance Account
Date: Wed, 05 Nov 2026 09:15:00 -0400

Hi Team,

Please find attached invoice #8841 for $450.00 for server maintenance.

Please note: Our regular bank account is currently undergoing an annual compliance audit. Do NOT send funds to our usual account. Please remit payment immediately to our temporary PayPal disbursement address: alice-payouts-temp@fastmail.com.

Thank you,
Alice Martin
Reliable Cloud Inc`,
    recordedReading: {
      vendorName: 'Reliable Cloud Inc',
      paymentRequested: true,
      payeeChangeRequested: true,
      payeeChangeMentioned: true,
      newPayeeIdentifiers: ['alice-payouts-temp@fastmail.com'],
      amount: 450.0,
      currency: 'USD',
      tactics: {
        urgency: true,
        secrecy: false,
        authority: false,
        avoid_phone: false
      },
      channelShift: false,
      giftCards: false,
      phonesInEmail: []
    },
    recordedSecondOpinion: {
      verdict: 'HOLD',
      reason: 'Classic payment redirection scam claiming an audit and directing funds to a fastmail address.'
    }
  },
  {
    id: 'sample-fraud-lookalike',
    title: 'Fraud: Lookalike Domain Typosquat',
    category: 'fraud',
    label: 'Fraud: Lookalike Domain',
    rawEmail: `From: "Reliable Cloud Billing" <billing@reliable-cloud.co>
To: accounting@mybusiness.com
Subject: URGENT: Server Renewal Termination Notice
Date: Wed, 05 Nov 2026 10:20:00 -0400

URGENT NOTICE:
Your company server hosting plan is scheduled for suspension within 4 hours due to an unpaid balance of $450.00 USD.

To avoid catastrophic data loss and service shutdown, remit the $450.00 immediately via PayPal to billing@reliable-cloud.co.

Immediate compliance required.
Reliable Cloud Infrastructure Billing`,
    recordedReading: {
      vendorName: 'Reliable Cloud Billing',
      paymentRequested: true,
      payeeChangeRequested: false,
      payeeChangeMentioned: false,
      newPayeeIdentifiers: ['billing@reliable-cloud.co'],
      amount: 450.0,
      currency: 'USD',
      tactics: {
        urgency: true,
        secrecy: false,
        authority: true,
        avoid_phone: false
      },
      channelShift: false,
      giftCards: false,
      phonesInEmail: []
    },
    recordedSecondOpinion: {
      verdict: 'HOLD',
      reason: 'Suspicious typosquatted domain (.co instead of .com with hyphen insertion) and heavy deadline pressure.'
    }
  },
  {
    id: 'sample-fraud-reply-to',
    title: 'Fraud: Reply-To Header Hijack',
    category: 'fraud',
    label: 'Fraud: Reply-To Mismatch',
    rawEmail: `From: "Global Logistics Ltd" <finance@globallogistics.io>
Reply-To: "Global Accounts Drop" <attacker-drop@freemail-box.org>
To: accounting@mybusiness.com
Subject: Payment for International Freight Invoice #GL-9921
Date: Wed, 05 Nov 2026 11:00:00 -0400

Dear Customer,

Enclosed is the shipping settlement bill for container shipment #GL-9921 totaling $1,200.00 USD.
Please reply directly to confirm transaction schedule.

Best regards,
Global Logistics Billing Operations`,
    recordedReading: {
      vendorName: 'Global Logistics Ltd',
      paymentRequested: true,
      payeeChangeRequested: false,
      payeeChangeMentioned: false,
      newPayeeIdentifiers: [],
      amount: 1200.0,
      currency: 'USD',
      tactics: {
        urgency: false,
        secrecy: false,
        authority: false,
        avoid_phone: false
      },
      channelShift: false,
      giftCards: false,
      phonesInEmail: []
    },
    recordedSecondOpinion: {
      verdict: 'HOLD',
      reason: 'Severe risk: Sender domain globallogistics.io routes all communication replies to freemail-box.org.'
    }
  },
  {
    id: 'sample-fraud-non-english',
    title: 'Fraud: Foreign Language (Spanish BEC)',
    category: 'fraud',
    label: 'Fraud: Spanish BEC',
    rawEmail: `From: "Suministros Industriales" <ventas@suministros-industriales.es>
To: accounting@mybusiness.com
Subject: [URGENTE] Actualización de datos bancarios para pago de servicios
Date: Thu, 06 Nov 2026 08:30:00 +0100

Estimado cliente,

Por motivos de reestructuración fiscal y cierre de ejercicio, le notificamos nuestro cambio de datos bancarios oficial. 
Por favor no utilice la cuenta anterior y envíe el pago de $890.00 USD de la factura pendiente a nuestra nueva cuenta de PayPal: tesoreria-temporal@seguro-pagos.net.

Agradecemos su pronta atención para evitar recargos por mora.

Atentamente,
Departamento de Tesorería`,
    recordedReading: {
      vendorName: 'Suministros Industriales',
      paymentRequested: true,
      payeeChangeRequested: true,
      payeeChangeMentioned: true,
      newPayeeIdentifiers: ['tesoreria-temporal@seguro-pagos.net'],
      amount: 890.0,
      currency: 'USD',
      tactics: {
        urgency: true,
        secrecy: false,
        authority: false,
        avoid_phone: false
      },
      channelShift: false,
      giftCards: false,
      phonesInEmail: []
    },
    recordedSecondOpinion: {
      verdict: 'HOLD',
      reason: 'Spanish-language BEC requesting redirection of pending invoice to a third-party account.'
    }
  },
  {
    id: 'sample-honest-invoice-1',
    title: 'Honest: Routine Cloud Server Invoice',
    category: 'honest',
    label: 'Honest: Cloud Invoice',
    rawEmail: `From: "Reliable Cloud Inc" <billing@reliablecloud.com>
To: accounting@mybusiness.com
Subject: Invoice #4092 for Monthly Server Hosting
Date: Thu, 06 Nov 2026 09:00:00 -0400

Hello,

Thank you for your ongoing partnership. Attached is invoice #4092 for your dedicated cloud hosting plan.

Total Due: $450.00 USD
Due Date: Net 15
Payee: billing@reliablecloud.com

You can settle this via PayPal or our standard corporate billing portal.

Warm regards,
Reliable Cloud Billing Team
phone: +1-555-0199`,
    recordedReading: {
      vendorName: 'Reliable Cloud Inc',
      paymentRequested: true,
      payeeChangeRequested: false,
      payeeChangeMentioned: false,
      newPayeeIdentifiers: ['billing@reliablecloud.com'],
      amount: 450.0,
      currency: 'USD',
      tactics: {
        urgency: false,
        secrecy: false,
        authority: false,
        avoid_phone: false
      },
      channelShift: false,
      giftCards: false,
      phonesInEmail: ['+1-555-0199']
    },
    recordedSecondOpinion: {
      verdict: 'CLEAR',
      reason: 'Standard recurring monthly server invoice matching existing vendor profile and typical amount.'
    }
  },
  {
    id: 'sample-honest-invoice-2',
    title: 'Honest: Office Supplies Invoice',
    category: 'honest',
    label: 'Honest: Office Supplies',
    rawEmail: `From: "Apex Office Solutions" <apex-accounts@gmail.com>
To: accounting@mybusiness.com
Subject: Invoice #2033 - November Breakroom & Office Supplies
Date: Thu, 06 Nov 2026 11:30:00 -0400

Hi Team,

Enclosed is the breakdown for the office supplies delivered on Monday.

Total: $275.50 USD
Invoice: #2033
Please remit payment to our PayPal address: apex-accounts@gmail.com

Let us know if you need any additional paper reams or printer cartridges.

Best regards,
Dave
Apex Office Solutions`,
    recordedReading: {
      vendorName: 'Apex Office Solutions',
      paymentRequested: true,
      payeeChangeRequested: false,
      payeeChangeMentioned: false,
      newPayeeIdentifiers: ['apex-accounts@gmail.com'],
      amount: 275.5,
      currency: 'USD',
      tactics: {
        urgency: false,
        secrecy: false,
        authority: false,
        avoid_phone: false
      },
      channelShift: false,
      giftCards: false,
      phonesInEmail: []
    },
    recordedSecondOpinion: {
      verdict: 'CHECK',
      reason: 'Small business invoice using Gmail. Verified against vendor records on file.'
    }
  },
  {
    id: 'sample-honest-bank-change-notice',
    title: 'Honest: Future Banking Notice (No Payment Request)',
    category: 'honest',
    label: 'Honest: Future Notice',
    rawEmail: `From: "Reliable Cloud Inc" <billing@reliablecloud.com>
To: accounting@mybusiness.com
Subject: Advisory: Upcoming Banking Transition in FY2027
Date: Fri, 07 Nov 2026 09:00:00 -0400

Dear Valued Partner,

We are writing to provide advance notification that Reliable Cloud Inc will be upgrading our commercial treasury services in January 2027.

PLEASE NOTE: NO ACTION IS REQUIRED AT THIS TIME.
Do not modify any payment details today. Continue to remit all current invoices to our established PayPal account (billing@reliablecloud.com).

Formal authenticated paperwork with notarized executive signatures will be provided next month.

Sincerely,
Reliable Cloud Treasury Department`,
    recordedReading: {
      vendorName: 'Reliable Cloud Inc',
      paymentRequested: false,
      payeeChangeRequested: false,
      payeeChangeMentioned: true,
      newPayeeIdentifiers: [],
      amount: null,
      currency: null,
      tactics: {
        urgency: false,
        secrecy: false,
        authority: false,
        avoid_phone: false
      },
      channelShift: false,
      giftCards: false,
      phonesInEmail: []
    },
    recordedSecondOpinion: {
      verdict: 'CLEAR',
      reason: 'Informational advance notice explicitly advising that no payment is requested today.'
    }
  },
  {
    id: 'sample-fraud-gift-card',
    title: 'Fraud: CEO Gift Card Scam',
    category: 'fraud',
    label: 'Fraud: Gift Cards',
    rawEmail: `From: "Executive Board" <ceo-office-direct@gmail.com>
To: bookkeeper@mybusiness.com
Subject: Urgent confidential request
Date: Fri, 07 Nov 2026 14:00:00 -0400

I am currently tied up in an all-day closed investor summit and cannot receive phone calls.

I need you to urgently purchase $500.00 in Apple gift cards for the partner presentation this afternoon. Once purchased, scratch the pins, take clear photos and email them directly to me right away.

Keep this discrete as it is a surprise recognition gift.

Best,
CEO Office`,
    recordedReading: {
      vendorName: 'Executive Board',
      paymentRequested: true,
      payeeChangeRequested: false,
      payeeChangeMentioned: false,
      newPayeeIdentifiers: [],
      amount: 500.0,
      currency: 'USD',
      tactics: {
        urgency: true,
        secrecy: true,
        authority: true,
        avoid_phone: true
      },
      channelShift: false,
      giftCards: true,
      phonesInEmail: []
    },
    recordedSecondOpinion: {
      verdict: 'HOLD',
      reason: 'Textbook CEO fraud asking for untraceable gift cards with secrecy and phone avoidance.'
    }
  }
];
