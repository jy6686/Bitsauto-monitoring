import openpyxl, sys, os
BASE='/home/runner/workspace/attached_assets'
PRODUCTS = [
    ('Destination_CODE_1781626466596.xlsx',    'FC','1'),
    ('2Destination_CODE_1781626488020.xlsx',   'BC','2'),
    ('6Destination_CODE_1781626482261.xlsx',   'SB','6'),
    ('7Destination_CODE_1781626474753.xlsx',   'SC','7'),
    ('No_prefixDestination_CODE_1781626445745.xlsx','NP',''),
]
def q(v):
    if v is None or v=='': return 'NULL'
    return "'"+str(v).replace("'","''")+"'"
def billing(s):
    try: p=str(s).split('/'); return int(p[0]),int(p[1])
    except: return 1,1

print("\\set ON_ERROR_ROLLBACK on")

for fname,code,trunk in PRODUCTS:
    path=f"{BASE}/{fname}"
    if not os.path.exists(path): print(f"-- SKIP {fname}",file=sys.stderr); continue
    print(f"-- Processing {code}",file=sys.stderr)

    # Create fresh temp table for this product
    print("""
CREATE TEMP TABLE IF NOT EXISTS tmp_imp(
  sippy_prefix text, raw_prefix text, product_code text,
  dest_name text, country_code text, level int,
  sell_rate float, interval_1 int, interval_n int,
  price_status text, cli_enabled bool, notes text
);
TRUNCATE tmp_imp;
""")

    wb=openpyxl.load_workbook(path,read_only=True,data_only=True); ws=wb.active
    batch=[]; n=0
    for ri,row in enumerate(ws.iter_rows(values_only=True),1):
        if ri<9 or not row[0]: continue
        try:
            cc=str(int(float(str(row[5])))) if row[5] not in (None,'') else ''
            ac=str(int(float(str(row[6])))) if row[6] not in (None,'') else ''
        except: continue
        if not cc: continue
        raw=cc+ac; sippy=trunk+raw
        dest=str(row[1]) if row[1] else str(row[0])
        price=row[7] if row[7] is not None else 0
        i1,iN=billing(row[8])
        level=1 if not ac else 2
        ps=q(str(row[10]) if row[10] else None)
        cm=q(str(row[11]) if row[11] else None)
        cli='true' if str(row[12] or '').upper()=='YES' else 'false'
        batch.append(f"({q(sippy)},{q(raw)},{q(code)},{q(dest)},{q(cc)},{level},{price},{i1},{iN},{ps},{cli},{cm})")
        n+=1
        if len(batch)>=1000:
            print("INSERT INTO tmp_imp VALUES")
            print(',\n'.join(batch)+';')
            batch=[]
    if batch:
        print("INSERT INTO tmp_imp VALUES")
        print(',\n'.join(batch)+';')

    # Upsert destinations and rates immediately for this product
    print(f"""
-- Upsert destinations for {code}
INSERT INTO global_destinations(name,dial_prefix,country_code,level,commercial_status)
SELECT DISTINCT ON (raw_prefix) dest_name,raw_prefix,country_code,level,'approved'
FROM tmp_imp
ORDER BY raw_prefix
ON CONFLICT(dial_prefix) WHERE dial_prefix IS NOT NULL
DO UPDATE SET name=EXCLUDED.name,commercial_status='approved';

-- Upsert rates for {code}
INSERT INTO destination_product_rates(product_prefix,dial_prefix,product_code,destination_name,sell_rate,buy_rate,interval_1,interval_n,price_status,cli_enabled,notes,approval_status,source,destination_id)
SELECT t.sippy_prefix,t.raw_prefix,t.product_code,t.dest_name,t.sell_rate,t.sell_rate,t.interval_1,t.interval_n,t.price_status,t.cli_enabled,t.notes,'approved','ibis-import',gd.id
FROM tmp_imp t
JOIN global_destinations gd ON gd.dial_prefix=t.raw_prefix
ON CONFLICT(destination_id,product_prefix) DO UPDATE SET sell_rate=EXCLUDED.sell_rate,updated_at=NOW();

SELECT '{code}' as product, COUNT(*) as rates FROM destination_product_rates WHERE product_code='{code}';
""")
    wb.close()
    print(f"-- {code}: {n} rows processed",file=sys.stderr)

print("SELECT product_code, COUNT(*) as total_rates FROM destination_product_rates GROUP BY product_code ORDER BY product_code;")
