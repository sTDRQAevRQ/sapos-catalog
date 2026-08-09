path = 'styles.css'
content = open(path).read()

old = '''  .dialog-visual {
    min-height: 168px;
    padding: 14px 14px 0;
  }'''
new = '''  .dialog-visual {
    min-height: 168px;
    padding: 44px 14px 0;
  }'''

count = content.count(old)
assert count == 1, f'Motif attendu 1 fois, trouve {count} fois — verifier le fichier avant de forcer'
content = content.replace(old, new, 1)
open(path, 'w').write(content)
print('OK styles.css — marge mobile de la zone image corrigee (14px -> 44px), le badge NOUVEAU ne chevauche plus les boutons')
