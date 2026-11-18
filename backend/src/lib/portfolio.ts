import { prisma } from '../db';

const PORTFOLIO_NAME = 'Head Office';
const PORTFOLIO_SLUG = 'portfolio';

/**
 * There is exactly one `Organization` row — the single portfolio every property belongs
 * to. It's created transparently on first use; the super admin manages properties and
 * their managers directly and never creates or picks an "organization".
 */
export async function getOrCreatePortfolioOrg() {
  const existing = await prisma.organization.findFirst({ orderBy: { createdAt: 'asc' } });
  if (existing) return existing;
  return prisma.organization.create({
    data: { name: PORTFOLIO_NAME, slug: PORTFOLIO_SLUG, contactEmail: 'admin@example.com' },
  });
}
