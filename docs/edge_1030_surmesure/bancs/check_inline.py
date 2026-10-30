import re,sys,subprocess,os,tempfile
for f in sys.argv[1:]:
    s=open(f,encoding='utf8').read()
    blocs=re.findall(r'<script(?![^>]*\bsrc=)[^>]*>(.*?)</script>',s,flags=re.S)
    ko=0
    for i,b in enumerate(blocs):
        p=tempfile.mktemp(suffix='.js'); open(p,'w').write(b)
        r=subprocess.run(['node','--check',p],capture_output=True,text=True)
        if r.returncode: ko+=1; print(f,'bloc',i,r.stderr[:600])
        os.unlink(p)
    print(f, len(blocs),'blocs,',ko,'en erreur')
