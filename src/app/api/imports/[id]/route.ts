import { z } from 'zod';
import { requireApiAuth } from '@/lib/auth';
import { importJsonBody } from '@/lib/imports/http';
import { addImportCandidates, commitImportCandidates, editImportCandidate, generateExtractCandidates, getImportBatch, purgeImportSource, updateImportSelection } from '@/lib/imports/service';
import { apiError } from '@/lib/store/http';
import type { ImportSelection, KnowledgeCandidateInput } from '@/lib/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
type Context = { params: Promise<{ id: string }> };
const revision = z.number().int().positive();
const operation = z.discriminatedUnion('action', [
  z.object({ action: z.literal('select'), selection: z.record(z.unknown()), expectedRevision: revision }).strict(),
  z.object({ action: z.literal('extract'), expectedRevision: revision }).strict(),
  z.object({ action: z.literal('candidates'), candidates: z.array(z.record(z.unknown())).min(1).max(500), expectedRevision: revision }).strict(),
  z.object({ action: z.literal('edit'), candidateId: z.string().min(1).max(200), candidate: z.record(z.unknown()), expectedRevision: revision }).strict(),
  z.object({ action: z.literal('commit'), candidateIds: z.array(z.string().min(1).max(200)).min(1).max(500), expectedRevision: revision }).strict(),
  z.object({ action: z.literal('purge'), expectedRevision: revision }).strict(),
]);

export async function GET(request: Request, context: Context) {
  const denied = await requireApiAuth(request); if (denied) return denied;
  try { return Response.json({ batch: await getImportBatch((await context.params).id) }); }
  catch (error) { return apiError(error); }
}

export async function PATCH(request: Request, context: Context) {
  const denied = await requireApiAuth(request); if (denied) return denied;
  try {
    const { id } = await context.params;
    const op = operation.parse(await importJsonBody(request));
    let batch;
    switch (op.action) {
      case 'select': batch = await updateImportSelection(id, op.selection as ImportSelection, op.expectedRevision); break;
      case 'extract': batch = await generateExtractCandidates(id, op.expectedRevision); break;
      case 'candidates': batch = await addImportCandidates(id, op.candidates as unknown as KnowledgeCandidateInput[], op.expectedRevision); break;
      case 'edit': batch = await editImportCandidate(id, op.candidateId, op.candidate as unknown as KnowledgeCandidateInput, op.expectedRevision); break;
      case 'commit': batch = await commitImportCandidates(id, op.candidateIds, op.expectedRevision); break;
      case 'purge': batch = await purgeImportSource(id, op.expectedRevision); break;
    }
    return Response.json({ batch });
  } catch (error) { return apiError(error); }
}
