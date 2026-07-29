-- ============================================================================
-- Raagam ERP -- 0353 Indent Approval Enrichment
-- From VB.NET FrmIndentApproval.vb — adds approval level tracking to indents.
-- ============================================================================

alter table public.purchase_indents
  add column if not exists approval_type     text check (approval_type in ('full','part')),
  add column if not exists user_approved_by   uuid references public.profiles(id),
  add column if not exists user_approved_at   timestamptz,
  add column if not exists md_approved_by     uuid references public.profiles(id),
  add column if not exists md_approved_at     timestamptz;

-- Add approval status per indent line (from VB.NET ApprovalStatus ValueList)
alter table public.purchase_indent_lines
  add column if not exists approval_status    text default 'pending'
    check (approval_status in ('pending','approved','rejected','partial')),
  add column if not exists approved_qty       numeric(14,3),
  add column if not exists last_po_rate       numeric(14,4),
  add column if not exists stock_qty          numeric(14,3);
