path = "client/src/pages/configuration-values.tsx"
with open(path, "r") as f:
    content = f.read()

old = """  const val = draft !== undefined ? draft : (row.value ?? "");"""

new = """  const val = draft !== undefined ? (draft ?? "") : (row.value ?? "");"""

c = content.count(old)
print(f"Found {c} match(es)")
if c == 1:
    content = content.replace(old, new)
    with open(path, "w") as f:
        f.write(content)
    print("Applied successfully")
else:
    print("MISMATCH — nothing was written.")
