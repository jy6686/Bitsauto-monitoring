import openpyxl, sys, os
BASE='/home/runner/workspace/attached_assets'
PRODUCTS = [
    ('Destination_CODE_1781626466596.xlsx',    'FC','1'),
    ('2Destination_CODE_1781626488020.xlsx',   'BC','2'),
    ('6Destination_CODE_1781626482261.xlsx',   'SB','6'),
    ('7Destination_CODE_1781626474753.xlsx',   'SC','7'),
    ('No_prefixDestination_CODE_1781626445745.xlsx','NP',''),
]
def billing(s):
    try: p=str(s).split('/'); return int(p[0]),int(p[1])
    except: return 1,1

print("\\set ON_ERROR_ROLLBACK on")
for fname,code,trunk in PRODUCTS:
    path=f"{BASE}/{fname}"
    if not os.path.exists(path): continue
    print(f"-- Updating rates for {code}",file=sys.stderr)
    wb=openpyxl.load_workbook(path,read_only=True,data_only=True); ws=wb.active
    batch=[]; n=0
    for ri,row in enumerate(ws.iter_rows(values_only=True),1):
        if ri<9 or not row[0]: continue
        try:
            cc=str(int(float(str(row[5])))) if row[5] not in (None,'') else ''
            ac=str(int(float(str(row[6])))) if row[6] not in (None,'') else ''
        except: continue
        if not cc: continue
        raw=cc+ac
        price=row[7] if row[7] is not None else 0
        i1,iN=billing(row[8])
        batch.append(f"('{trunk+raw}',{price},{price},{i1},{iN})")
        n+=1
        if len(batch)>=2000:
            print(f"UPDATE destination_product_rates AS dpr SET sell_rate=v.sr,buy_rate=v.br,interval_1=v.i1,interval_n=v.in_,updated_at=NOW()")
            print(f"FROM (VALUES {','.join(batch)}) AS v(pp,sr,br,i1,in_)")
            print(f"WHERE dpr.product_prefix=v.pp AND dpr.product_code='{code}';")
            batch=[]
    if batch:
        print(f"UPDATE destination_product_rates AS dpr SET sell_rate=v.sr,buy_rate=v.br,interval_1=v.i1,interval_n=v.in_,updated_at=NOW()")
        print(f"FROM (VALUES {','.join(batch)}) AS v(pp,sr,br,i1,in_)")
        print(f"WHERE dpr.product_prefix=v.pp AND dpr.product_code='{code}';")
    wb.close()
    print(f"-- {code}: {n} rates updated",file=sys.stderr)

print("SELECT product_code, COUNT(*) FILTER(WHERE sell_rate>0) as priced, COUNT(*) FILTER(WHERE sell_rate=0) as zero_rate FROM destination_product_rates GROUP BY product_code ORDER BY product_code;")
