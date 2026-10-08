import { paginated, resolvePage } from '../../src/common/pagination/pagination';

describe('paginação', () => {
  afterEach(() => delete process.env.PAGINATION_MAX_LIMIT);

  it('usa page=1 e limit=20 por padrão', () => {
    expect(resolvePage({})).toEqual({ page: 1, limit: 20, skip: 0, take: 20 });
  });

  it('limita o limit ao máximo (100 por padrão)', () => {
    expect(resolvePage({ page: 2, limit: 5000 })).toMatchObject({ limit: 100, skip: 100 });
  });

  it('o máximo é configurável por PAGINATION_MAX_LIMIT', () => {
    process.env.PAGINATION_MAX_LIMIT = '10';
    expect(resolvePage({ limit: 50 }).limit).toBe(10);
  });

  it('monta o meta com totalPages', () => {
    const page = resolvePage({ page: 1, limit: 10 });
    expect(paginated([1, 2], 25, page).meta).toEqual({
      page: 1,
      limit: 10,
      total: 25,
      totalPages: 3,
    });
  });
});
