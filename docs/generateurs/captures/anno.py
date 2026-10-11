# Draw numbered annotations, export webp
import json,sys
from PIL import Image, ImageDraw, ImageFont
B=json.load(open('boxes.json'))
F=ImageFont.truetype('/sessions/quirky-affectionate-hypatia/.fonts/DejaVuSans-Bold.ttf',30)
GOLD=(232,184,74); DARK=(20,16,8)
only=sys.argv[1] if len(sys.argv)>1 else ''
import os
os.makedirs('out',exist_ok=True)
for k,v in B.items():
  if only and not k.startswith(only): continue
  im=Image.open('raw/%s.png'%k).convert('RGB'); d=ImageDraw.Draw(im,'RGBA')
  ox,oy=(v['clip']['x'],v['clip']['y']) if v.get('clip') else (0,0)
  for i,(a,bx) in enumerate(zip(v['ann'],v['boxes'])):
    if not bx: continue
    x0=(bx['x']-ox)*2-6; y0=(bx['y']-oy)*2-6; x1=x0+bx['w']*2+12; y1=y0+bx['h']*2+12
    if not a.get('nobox'):
      d.rounded_rectangle((x0,y0,x1,y1),radius=14,outline=GOLD+(255,),width=5)
    n=str(a.get('n',i+1)); pos=a.get('pos','tl'); r=24
    cx={'tl':x0,'tr':x1,'l':x0,'r':x1,'c':(x0+x1)/2}.get(pos,x0); cy={'tl':y0,'tr':y0,'l':(y0+y1)/2,'r':(y0+y1)/2,'c':(y0+y1)/2}.get(pos,y0)
    cx=min(max(cx,r+4),im.width-r-4); cy=min(max(cy,r+4),im.height-r-4)
    d.ellipse((cx-r-3,cy-r-3,cx+r+3,cy+r+3),fill=(0,0,0,170))
    d.ellipse((cx-r,cy-r,cx+r,cy+r),fill=GOLD+(255,))
    tw=d.textlength(n,font=F); d.text((cx-tw/2,cy-18),n,font=F,fill=DARK)
  W=1200 if im.width>1200 else im.width
  if im.width>W: im=im.resize((W,int(im.height*W/im.width)),Image.LANCZOS)
  im.save('out/%s.webp'%k,quality=82,method=6)
  print(k,im.size)
