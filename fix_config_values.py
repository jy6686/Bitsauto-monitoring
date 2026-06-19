path = "client/src/pages/configuration-values.tsx"
with open(path, "r") as f:
    content = f.read()

old = """  const { data: rows = [], isLoading } = useQuery<ConfigValue[]>({
    queryKey: ["/api/configuration-values", activeTab],
    queryFn: () => fetch(`/api/configuration-values?category=${activeTab}`, { credentials: "include" }).then(r => r.json()),
  });"""

new = """  const { data: rows = [], isLoading } = useQuery<ConfigValue[]>({
    queryKey: ["/api/configuration-values", activeTab],
    queryFn: () => fetch(`/api/configuration-values?category=${activeTab}`, { credentials: "include" })
      .then(r => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); })
      .then(d => Array.isArray(d) ? d : []),
  });"""

c = content.count(old)
print(f"Found {c} match(es)")
if c == 1:
    content = content.replace(old, new)
    with open(path, "w") as f:
        f.write(content)
    print("Applied successfully")
else:
    print("MISMATCH — nothing was written.")
