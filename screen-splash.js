/* Player-only lens water. Reuse a bounded DOM pool; no full-screen render pass. */
(function(root){
  class ScreenSplash{
    constructor(doc=document){
      this.age=10;this.strength=0;this.active=false;
      this.layer=doc.createElement('div');this.layer.className='lens-splash';
      this.layer.setAttribute('aria-hidden','true');this.layer.style.display='none';
      this.sheet=doc.createElement('div');this.sheet.className='lens-water-sheet';this.layer.appendChild(this.sheet);
      this.drops=Array.from({length:26},()=>{
        const el=doc.createElement('div');el.className='lens-water-drop';this.layer.appendChild(el);return {el};
      });
      doc.body.appendChild(this.layer);
    }
    trigger(impact){
      if(impact<4)return;
      this.age=0;this.strength=Math.min(1,Math.max(.12,(impact-4)/24));this.active=true;
      this.layer.style.display='block';
      this.layer.dataset.active='true';
      const count=Math.round(10+16*this.strength);
      this.drops.forEach((d,i)=>{
        d.el.style.display=i<count?'block':'none';
        d.x=.04+Math.random()*.92;d.y=.1+Math.random()*.78;
        // Keep the horizon center readable, while a few fine beads cross the player's view.
        if(d.x>.36&&d.x<.64&&d.y>.32&&d.y<.68)d.x+=d.x<.5?-.19:.19;
        d.size=(i%5===0?38:9)+Math.random()*24;d.size*=.65+this.strength*.5;
        d.life=1.1+Math.random()*1.25;d.delay=Math.random()*.07;
        d.slide=18+Math.random()*65;d.tilt=(Math.random()-.5)*35;
        d.el.style.width=d.size+'px';d.el.style.height=d.size*(1.15+Math.random()*.65)+'px';
        d.el.style.borderRadius=`${38+Math.random()*20}% ${38+Math.random()*20}% 48% 46%`;
      });
      this.update(0);
    }
    update(dt){
      if(!this.active)return;
      this.age+=dt;
      const age=this.age;
      if(age>=2.5){
        this.active=false;this.layer.style.display='none';this.layer.dataset.active='false';return;
      }
      const wash=Math.max(0,1-age/.46);
      this.sheet.style.opacity=String(wash*wash*(.2+this.strength*.34));
      this.sheet.style.transform=`translateY(${age*28}px) scale(${1+age*.2})`;
      for(const d of this.drops){
        const t=Math.max(0,age-d.delay),fade=Math.max(0,1-t/d.life);
        const appear=Math.min(1,t/.045);
        d.el.style.opacity=String(appear*fade*fade*(.48+this.strength*.35));
        const slide=Math.max(0,t-.15)**2*d.slide;
        const burst=-Math.sin(Math.min(1,t/.16)*Math.PI/2)*12*this.strength;
        d.el.style.left=(d.x*100)+'%';d.el.style.top=(d.y*100)+'%';
        d.el.style.transform=`translate3d(0,${slide+burst}px,0) rotate(${d.tilt}deg) scale(${.7+Math.min(1,t/.1)*.3},${1+Math.min(.35,t*.16)})`;
      }
    }
  }
  if(typeof module!=='undefined'&&module.exports)module.exports=ScreenSplash;else root.ScreenSplash=ScreenSplash;
})(typeof window!=='undefined'?window:globalThis);
