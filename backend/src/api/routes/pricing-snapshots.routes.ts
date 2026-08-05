import { Router } from 'express';
import { PricingSnapshotRepository, type PricingSnapshotItem } from '../../db/repositories/pricing-snapshot.repository';

const router = Router();

// GET /api/pricing-snapshots — every snapshot ever captured, newest first
router.get('/', (_req, res, next) => {
  try {
    res.json(PricingSnapshotRepository.listAll());
  } catch (err) { next(err); }
});

// GET /api/pricing-snapshots/latest — most recent price per product
router.get('/latest', (_req, res, next) => {
  try {
    res.json(PricingSnapshotRepository.latestPerProduct());
  } catch (err) { next(err); }
});

// GET /api/pricing-snapshots/history/:product — full price history for one product
router.get('/history/:product', (req, res, next) => {
  try {
    res.json(PricingSnapshotRepository.history(req.params.product));
  } catch (err) { next(err); }
});

// POST /api/pricing-snapshots/capture
// Records a new timestamped snapshot. Datadog's public pricing pages render prices
// client-side, so there's no reliable server-side scrape — snapshots are captured by
// fetching https://www.datadoghq.com/pricing/list/ (e.g. via Claude/an operator) and
// posting the parsed line items here.
router.post('/capture', (req, res, next) => {
  try {
    const { sourceUrl, capturedAt, items } = req.body as {
      sourceUrl?: string;
      capturedAt?: string;
      items?: PricingSnapshotItem[];
    };
    if (!sourceUrl) { res.status(400).json({ error: 'sourceUrl required' }); return; }
    if (!Array.isArray(items) || items.length === 0) { res.status(400).json({ error: 'items must be a non-empty array' }); return; }
    for (const item of items) {
      if (!item.product || !item.unit || typeof item.price !== 'number') {
        res.status(400).json({ error: 'each item requires product, unit, and numeric price' });
        return;
      }
    }
    const captured = PricingSnapshotRepository.capture(sourceUrl, items, capturedAt);
    res.status(201).json(captured);
  } catch (err) { next(err); }
});

export default router;
