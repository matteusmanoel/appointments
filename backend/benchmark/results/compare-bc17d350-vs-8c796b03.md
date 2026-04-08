# Comparação Baseline × Candidato

**Baseline:** `bc17d350`  
**Candidato:** `8c796b03`  
**Data:** 03/04/2026, 11:58:19

## ⚠️ Resultado do Gate

**Recomendação:** `manual_review`  
**Motivo:** One gate rule failed: Too many new violations: Δ4 exceeds max 2. Review before promoting.

### Regras do Gate

**✓ zero_new_critical_violations**
> No new critical violations (0 vs 0)
> Baseline: `0` → Candidato: `0`

**✗ total_violations_not_worse**
> Too many new violations: Δ4 exceeds max 2
> Baseline: `11` → Candidato: `15`

**✓ quality_score_retained**
> Skipped — judge data not available for one or both runs

**✓ task_completion_not_regressed**
> Task completion OK: 98.0% >= 95.0% required
> Baseline: `100.0%` → Candidato: `98.0%`

**✓ cost_not_exploded**
> Skipped — no token data in baseline

**✓ avg_score_not_regressed**
> Avg score OK: 99.61 >= 97 (baseline 100 - 3pts tolerance)
> Baseline: `100` → Candidato: `99.61`

## Variações (Candidato − Baseline)

| Métrica | Delta |
|---------|-------|
| Score médio | **-0.39** ❌ |
| Violações críticas | 0 — |
| Total de violações | **+4** ✅ |
| Taxa de conclusão | **-2%** ❌ |
| Tokens médios/cenário | 0 — |

---
*Gerado em 2026-04-03T14:58:19.139Z*