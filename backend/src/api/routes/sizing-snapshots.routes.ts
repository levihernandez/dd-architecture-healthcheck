import { Router } from 'express';
import { SizingSnapshotRepository, type SizingSnapshotInput } from '../../db/repositories/sizing-snapshot.repository';

const router = Router();

// GET /api/sizing-snapshots — every saved sizing, newest first (without the full state blob)
router.get('/', (_req, res, next) => {
  try {
    res.json(SizingSnapshotRepository.listAll());
  } catch (err) { next(err); }
});

// GET /api/sizing-snapshots/:id — full record including the state blob, for loading
router.get('/:id', (req, res, next) => {
  try {
    const record = SizingSnapshotRepository.findById(req.params.id);
    if (!record) { res.status(404).json({ error: 'not found' }); return; }
    res.json(record);
  } catch (err) { next(err); }
});

// POST /api/sizing-snapshots — save a named snapshot of the current calculator configuration
router.post('/', (req, res, next) => {
  try {
    const body = req.body as Partial<SizingSnapshotInput>;
    if (!body.name || typeof body.name !== 'string') { res.status(400).json({ error: 'name required' }); return; }
    if (!body.mode || typeof body.mode !== 'string') { res.status(400).json({ error: 'mode required' }); return; }
    if (typeof body.totalListPrice !== 'number') { res.status(400).json({ error: 'totalListPrice required' }); return; }
    if (typeof body.categoryCount !== 'number') { res.status(400).json({ error: 'categoryCount required' }); return; }
    if (!body.cart || !body.state) { res.status(400).json({ error: 'cart and state required' }); return; }

    const created = SizingSnapshotRepository.create({
      name: body.name,
      mode: body.mode,
      orgId: body.orgId,
      orgName: body.orgName,
      totalListPrice: body.totalListPrice,
      totalRealCost: body.totalRealCost,
      categoryCount: body.categoryCount,
      cart: body.cart,
      state: body.state as Record<string, unknown>,
    });
    res.status(201).json(created);
  } catch (err) { next(err); }
});

// DELETE /api/sizing-snapshots/:id
router.delete('/:id', (req, res, next) => {
  try {
    const deleted = SizingSnapshotRepository.delete(req.params.id);
    if (!deleted) { res.status(404).json({ error: 'not found' }); return; }
    res.status(204).send();
  } catch (err) { next(err); }
});

export default router;
