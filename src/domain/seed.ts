import { shiftDate } from "./dates.ts";
import type { DemandSeries, Provider, Workspace } from "./types.ts";
import { INSTRUMENTS } from "./types.ts";

export function baseProviders(asOf: string): Provider[] {
  return [
    {
      id: "north",
      name: "Northside Behavioral Health",
      area: "Area A",
      service: "Depression and anxiety",
      payer: "Medicaid",
      language: "English",
      capacity: 120,
      wait: 8,
      travel: 18,
      verified: asOf,
    },
    {
      id: "east",
      name: "East Community Counseling",
      area: "Area B",
      service: "Depression and anxiety",
      payer: "Commercial",
      language: "English, Spanish",
      capacity: 80,
      wait: 12,
      travel: 24,
      verified: asOf,
    },
    {
      id: "bridge",
      name: "Bridge Access Clinic",
      area: "Area A",
      service: "Depression and anxiety",
      payer: "Medicaid",
      language: "Spanish",
      capacity: 0,
      wait: 20,
      travel: 12,
      verified: asOf,
    },
  ];
}

export function demandHistory(asOf: string): DemandSeries[] {
  const originMonth = asOf.slice(0, 7);
  return [
    { area: "Area A", originMonth, values: [168, 172, 176, 180, 174, 182, 186, 190, 184, 192, 196, 198, 204, 200] },
    { area: "Area B", originMonth, values: [84, 86, 88, 90, 87, 91, 93, 95, 92, 96, 98, 99, 102, 100] },
  ];
}

export function seedWorkspace(asOf: string): Workspace {
  const encounter = (days: number) => shiftDate(asOf, days);
  return {
    records: [
      {
        id: "BH-1041",
        token: "DEMO-041",
        area: "Area A",
        need: "Depression",
        payer: "Medicaid",
        language: "English",
        score: 12,
        status: "Submitted",
        encounter: encounter(-2),
        instrument: INSTRUMENTS.Depression.id,
        consent: true,
      },
      {
        id: "BH-1042",
        token: "DEMO-042",
        area: "Area B",
        need: "Anxiety",
        payer: "Commercial",
        language: "Spanish",
        score: 9,
        status: "Returned",
        reason: "Confirm screening completion and patient preference.",
        encounter: encounter(-3),
        instrument: INSTRUMENTS.Anxiety.id,
        consent: true,
      },
      {
        id: "BH-1043",
        token: "DEMO-043",
        area: "Area A",
        need: "Anxiety",
        payer: "Medicaid",
        language: "English",
        score: 8,
        status: "Approved",
        encounter: encounter(-10),
        instrument: INSTRUMENTS.Anxiety.id,
        consent: true,
      },
      {
        id: "BH-1044",
        token: "DEMO-044",
        area: "Area B",
        need: "Depression",
        payer: "Commercial",
        language: "Spanish",
        score: 11,
        status: "Approved",
        encounter: encounter(-48),
        instrument: INSTRUMENTS.Depression.id,
        consent: true,
      },
      {
        id: "BH-1045",
        token: "DEMO-045",
        area: "Area A",
        need: "Depression",
        payer: "Medicaid",
        language: "Spanish",
        score: null,
        status: "Submitted",
        encounter: encounter(-1),
        instrument: INSTRUMENTS.Depression.id,
        consent: false,
        urgent: true,
      },
      {
        id: "BH-1046",
        token: "DEMO-046",
        area: "Area A",
        need: "Anxiety",
        payer: "Medicaid",
        language: "English",
        score: 7,
        status: "Approved",
        encounter: encounter(-40),
        instrument: INSTRUMENTS.Anxiety.id,
        consent: true,
      },
    ],
    providers: baseProviders(asOf),
    demand: demandHistory(asOf),
    referrals: [
      {
        id: "RF-201",
        caseId: "BH-1043",
        provider: "north",
        owner: "Casey Morgan",
        sent: encounter(-9),
        due: encounter(-1),
        status: "Sent",
        events: [],
      },
      {
        id: "RF-202",
        caseId: "BH-1044",
        provider: "east",
        owner: "Jordan Lee",
        sent: encounter(-46),
        due: encounter(-40),
        status: "Closed",
        outcome: "Verified attendance",
        events: [
          {
            type: "Verified attendance",
            when: encounter(-38),
            note: "Confirmed by demo provider",
          },
        ],
      },
      {
        id: "RF-203",
        caseId: "BH-1046",
        provider: "north",
        owner: "Casey Morgan",
        sent: encounter(-38),
        due: encounter(-2),
        status: "Follow-up",
        events: [
          {
            type: "Outcome unknown",
            when: encounter(-3),
            note: "Awaiting provider confirmation",
          },
        ],
      },
    ],
    audit: [],
  };
}
