import { ParsedEmail, EmailAIAnalysis, SecondOpinion } from '../../domain/types.js';

export interface ISecondOpinionJudge {
  evaluateSecondOpinion(
    parsedEmail: ParsedEmail,
    primaryAnalysis: EmailAIAnalysis
  ): Promise<SecondOpinion | null>;
}
