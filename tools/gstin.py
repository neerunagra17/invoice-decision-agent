CH = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ"
def check(g14):
    s = 0
    for i, c in enumerate(g14):
        p = CH.index(c) * (1 if i % 2 == 0 else 2)
        s += p // 36 + p % 36
    return CH[(36 - s % 36) % 36]
def make(state, pan, entity='1'):
    b = f"{state}{pan}{entity}Z"; return b + check(b)
def valid(g):
    return len(g) == 15 and check(g[:14]) == g[14]
if __name__ == '__main__':
    for st, pan in [('09','AAACG4821K'),('24','AAICS7310M'),('29','AAKFN2286P'),('09','AAFFG5512Q'),('27','AAECA9043R'),('09','ABAFS1178L')]:
        g = make(st, pan); print(g, valid(g))
