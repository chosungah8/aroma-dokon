'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { buildPromotionExcelDownload } = require('../lib/promotion-excel-download.js');

function mockXlsx() {
    const view = { rows: null, sheet: null, calls: [] };
    const xlsx = {
        utils: {
            book_new: () => ({ sheets: [] }),
            aoa_to_sheet: rows => { view.rows = rows; return { '!cols': [] }; },
            book_append_sheet: (book, sheet, name) => { view.sheet = sheet; book.sheets.push({ sheet, name }); }
        },
        write: (book, options) => {
            view.calls.push(options);
            assert.equal(book.sheets[0].name, 'Ishtirokchilar');
            return Buffer.from('test-xlsx-content');
        }
    };
    return { view, xlsx };
}
function mockSupabase(pages, observed) {
    return {
        from(table) {
            assert.equal(table, 'promotion_participants');
            return {
                select(columns) {
                    assert.match(columns, /participant_number/);
                    return {
                        eq(column, id) {
                            assert.equal(column, 'promotion_id');
                            assert.equal(id, 7);
                            return {
                                order(orderColumn, options) {
                                    assert.equal(orderColumn, 'participant_number');
                                    assert.equal(options.ascending, true);
                                    return {
                                        async range(from, to) {
                                            observed.push([from, to]);
                                            return { data: pages.shift() ?? [], error: null };
                                        }
                                    };
                                }
                            };
                        }
                    };
                }
            };
        }
    };
}

test('all participant pages export directly without storage write or DB update', async () => {
    const all = Array.from({ length: 501 }, (_, i) => ({
        participant_number: i + 1,
        phone: `998901234${String(i).padStart(3, '0')}`,
        customer_name: i ? 'Mijoz' : '=SUM(1,1)',
        customer_username: 'username',
        created_at: '2026-10-21T01:00:00Z'
    }));
    const observed = [];
    const {view, xlsx} = mockXlsx();
    const result = await buildPromotionExcelDownload(mockSupabase([all.slice(0, 500), all.slice(500)], observed), xlsx, 7);
    assert.ok(Buffer.isBuffer(result));
    assert.deepEqual(observed, [[0,499],[500,999]]);
    assert.equal(view.rows.length, 502);
    assert.equal(view.rows[0][0], 'Ishtirok raqami');
    assert.equal(view.rows[501][0], 501);
    assert.equal(view.rows[1][2], '=SUM(1,1)'); // Passed as text to SheetJS, not a formula.
    assert.deepEqual(view.calls[0], { type: 'buffer', bookType: 'xlsx' });
    assert.equal(view.sheet['!cols'].length, 5);
});

test('empty promotions export the header row', async () => {
    const {view, xlsx} = mockXlsx();
    await buildPromotionExcelDownload(mockSupabase([[]], []), xlsx, 7);
    assert.equal(view.rows.length, 1);
});

test('invalid promotion ID is rejected', async () => {
    const {xlsx} = mockXlsx();
    await assert.rejects(() => buildPromotionExcelDownload({}, xlsx, '../../1'), /ID/);
});

test('query errors do not return a fabricated Excel file', async () => {
    const {xlsx} = mockXlsx();
    const sb = { from: () => ({ select: () => ({ eq: () => ({ order: () => ({
        range: async () => ({ data: null, error: Error('DB error') })
    }) }) }) }) };
    await assert.rejects(() => buildPromotionExcelDownload(sb, xlsx, 7), /DB error/);
});
