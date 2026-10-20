#!/usr/bin/env python3
"""Validate 13 chapters / 153 original paragraphs and build the study edition."""
from pathlib import Path
import hashlib,json
ROOT=Path(__file__).resolve().parent
chapters=json.loads((ROOT/'sutra-source.json').read_text())
glossary=json.loads((ROOT/'glossary.json').read_text())
assert len(chapters)==13
expected=[16,4,10,20,6,19,8,16,13,12,5,15,9]
volumes=[('上','本愿缘起','法会、过去身与业缘'),('中','修福与教化','知苦、礼敬、存亡与称名'),('下','布施与付嘱','回向、护法、见闻利益与托付')]
book={'title':'地藏菩萨本愿经','chapters':[{'title':'卷'+v,'subtitle':s,'intro':i,'sections':[]} for v,s,i in volumes]}
for n,ch in enumerate(chapters,1):
 assert ch['number']==n
 assert len(ch['paragraphs'])==expected[n-1]
 pairs=[]
 for i,p in enumerate(ch['paragraphs'],1):
  assert all(isinstance(p[k],str) and p[k].strip() for k in ['original','traditional','label','annotation'])
  assert hashlib.sha256(p['traditional'].encode()).hexdigest()==p['sourceHash'],f'Original source changed at {n}.{i}; review provenance before updating hash.'
  pairs.append({'orig':p['original'],'traditional':p['traditional'],'trans':p['annotation'],'label':p['label'],'number':i})
 corpus=''.join(p['orig'] for p in pairs)
 notes=[x for x in glossary if x['term'] in corpus]
 sec={'id':f'pin-{n:02}','number':n,'name':ch['name'],'title':ch['title'],'theme':ch['theme'],'intro':ch['intro'],'insight':ch['insight'],'source':ch['source'],'pairs':pairs,'notes':notes}
 ci=0 if n<=4 else 1 if n<=9 else 2
 book['chapters'][ci]['sections'].append(sec)
assert sum(len(s['pairs']) for c in book['chapters'] for s in c['sections'])==153
(ROOT/'book.js').write_text('window.BOOK = '+json.dumps(book,ensure_ascii=False,separators=(',',':'))+';\n')
print('Validated 13 chapters, 153 individually annotated paragraphs, source hashes and 3 volumes.')
