"""
cinematic_shell.py — the Tier 3 trailer visual system shared by mastsolutions.html and the Atlas Glinn pages.

One shell, two palettes. Every cinematic page is assembled from these pieces so the two sites cannot drift:
  css(palette, booking_css, extra)  the shell stylesheet (fonts, reticle, intro, chapter nav, HUD, panels, tiles, glass)
  three(sections, palette)          the three.js emblem scene + scroll camera + reveals (a module script body)
  head(meta_html, css_text)         <!DOCTYPE …> through <body>
  chrome(...)                       intro credits, canvas, photo layer, grain, vignette, letterbox, progress, reticle, HUD, chapter nav
  tile(num, title, body, img, pos)  a glass photo tile
  tail(three_js, classic_js)        the script tags and closing tags

MAST is the reference palette (gold). ATLAS swaps every gold token for the Atlas Glinn blue. Palettes are string
maps applied to the finished CSS/JS, so the MAST build stays byte-identical to the page before this module existed.
Edit the shell here; both assemblers pick it up on their next run.
"""

CSS_A = r"""
  @import url('https://fonts.googleapis.com/css2?family=Orbitron:wght@700;900&family=Rajdhani:wght@300;400;600;700&family=Share+Tech+Mono&family=Cinzel:wght@600;900&display=swap');
  :root {
    --midnight:#050810; --deep-navy:#0B1221; --gunmetal:#1E2A3A; --gunmetal-lt:#2C3845; --steel:#3A4A5C;
    --gold:#C9A84C; --gold-antique:#D4AF37; --gold-champagne:#E8D27D; --gold-bright:#FCF6BA; --copper:#B87333;
    --text:#F0F4FF; --text-dim:#8B95A8; --text-mute:#5B6474;
  }
  * { margin:0; padding:0; box-sizing:border-box; }
  html { scroll-behavior:smooth; }
  html, body { background:var(--midnight); color:var(--text); font-family:'Rajdhani',sans-serif; overflow-x:hidden; cursor:none; }
  a { color:inherit; }
  .reticle { position:fixed; top:0; left:0; width:44px; height:44px; pointer-events:none; z-index:10000; transform:translate(-50%,-50%); mix-blend-mode:difference; }
  .reticle::before, .reticle::after { content:''; position:absolute; background:var(--gold-champagne); }
  .reticle::before { top:50%; left:0; width:100%; height:1px; transform:translateY(-50%); }
  .reticle::after { left:50%; top:0; width:1px; height:100%; transform:translateX(-50%); }
  .reticle-ring { position:absolute; inset:10px; border:1px solid var(--gold); border-radius:50%; opacity:.7; }
  .reticle-dot { position:absolute; top:50%; left:50%; width:3px; height:3px; background:var(--gold-bright); border-radius:50%; transform:translate(-50%,-50%); }
  #three-canvas { position:fixed; inset:0; width:100vw; height:100vh; z-index:1; pointer-events:none; }
  /* Photography layer: one still per chapter, ghosted behind the 3D emblem and the grain */
  #photos { position:fixed; inset:0; z-index:2; pointer-events:none; }
  /* Backdrop crossfade: the outgoing photograph leaves faster than the incoming one arrives, so the two never stack to a brighter
     frame mid-switch (Brockmann, 2026-09-04: "the background pulled forward"). */
  #photos .ph { position:absolute; inset:0; background:center/cover no-repeat; opacity:0; transition:opacity .6s ease; filter:saturate(.72) contrast(1.06); }
  #photos .ph.on { transition:opacity 1.6s ease .3s; }
  #photos .ph::after { content:''; position:absolute; inset:0; background:linear-gradient(180deg, rgba(5,8,16,.42) 0%, rgba(5,8,16,.08) 45%, rgba(5,8,16,.72) 100%); }
  /* A chapter backdrop can be a film snippet instead of a still (Brockmann, 2026-09-05: "the video should be in the background,
     just a snippet playing, like the current website"). The still stays underneath as the poster; the clip fades in once it
     plays, loops, muted, and only while its chapter is on screen. */
  #photos .ph video { position:absolute; inset:0; width:100%; height:100%; object-fit:cover; object-position:inherit; opacity:0; transition:opacity 1.2s ease; }
  #photos .ph video.playing { opacity:1; }
  #photos .ph.film.on { opacity:.58; }
  /* A YouTube film as the backdrop, the way the current Atlas pages embed their hero films (autoplay, muted, loop,
     no controls): the frame is oversized to cover the viewport at 16:9 and cannot be clicked. */
  #photos .ph.yt iframe { position:absolute; top:50%; left:50%; width:100vw; height:56.25vw; min-height:100%; min-width:177.78vh; transform:translate(-50%,-50%); border:0; pointer-events:none; opacity:0; transition:opacity 1.2s ease; }
  #photos .ph.yt iframe.playing { opacity:1; }
  /* Backdrop presence (Brockmann, 2026-09-05: pull the background forward, keep the layers; then "Reduce background brightness by
     20%"): the photograph sits at .42 (.52 less a fifth), the scene and the text layers stay above it. */
  #photos .ph.on { opacity:.42; }
  .grain { position:fixed; inset:0; z-index:3; pointer-events:none; opacity:.035; background-image:repeating-linear-gradient(0deg, transparent 0, transparent 2px, rgba(255,255,255,.3) 2px, rgba(255,255,255,.3) 3px); mix-blend-mode:overlay; }
  .vignette { position:fixed; inset:0; z-index:4; pointer-events:none; background:radial-gradient(ellipse at center, transparent 0%, transparent 55%, rgba(5,8,16,.75) 100%); }
  .letterbox-top, .letterbox-bottom { position:fixed; left:0; right:0; height:0; background:#000; z-index:50; pointer-events:none; transition:height .6s cubic-bezier(.7,.15,.3,.95); }
  .letterbox-top { top:0; } .letterbox-bottom { bottom:0; }
  body.cinema .letterbox-top, body.cinema .letterbox-bottom { height:50px; }
  #intro-seq { position:fixed; inset:0; z-index:9000; background:#000; display:flex; align-items:center; justify-content:center; flex-direction:column; font-family:'Cinzel',serif; pointer-events:none; transition:opacity 1s ease-out; }
  #intro-seq.done { opacity:0; }
  .intro-credit { position:relative; z-index:1; font-size:.75rem; letter-spacing:.6em; color:var(--text-dim); opacity:0; animation:introFade 2.8s ease-in-out forwards; text-transform:uppercase; }
  /* The gold sparkle ring from the atlasglinn.com intro, drawn around the wordmark; the script fades it in after the wordmark and out before the splash ends. */
  .intro-ring { position:absolute; inset:0; width:100%; height:100%; z-index:0; opacity:0; pointer-events:none; }
  .intro-credit:nth-child(1) { animation-delay:.3s; }
  .intro-credit:nth-child(2) { animation-delay:1.2s; margin-top:1.8rem; color:var(--gold); font-weight:900; font-size:1.5rem; letter-spacing:.35em; }
  .intro-credit:nth-child(3) { animation-delay:2.6s; margin-top:1.5rem; color:var(--gold-champagne); font-size:.85rem; letter-spacing:.5em; }
  @keyframes shimmer { 0% { background-position:-1000px 0; } 100% { background-position:1000px 0; } }
  .intro-credit.wordmark { font-family:'Orbitron',sans-serif; font-weight:900; font-size:clamp(2rem,6.5vw,4.6rem); letter-spacing:.16em; line-height:1.1; margin-top:1.4rem; padding:0 1rem; background:linear-gradient(90deg, #BF953F 0%, #FCF6BA 25%, #B38728 50%, #FBF5B7 75%, #AA771C 100%); background-size:1000px 100%; -webkit-background-clip:text; background-clip:text; -webkit-text-fill-color:transparent; color:transparent; text-shadow:0 0 60px rgba(201,168,76,.35); animation:introFade 3.4s ease-in-out forwards, shimmer 2.6s linear infinite; animation-delay:1.1s, 1.1s; }
  @keyframes introFade { 0% { opacity:0; transform:translateY(8px); } 18%, 75% { opacity:1; transform:translateY(0); } 100% { opacity:0; transform:translateY(-8px); } }
  .chapter-nav { position:fixed; right:1.5rem; top:50%; transform:translateY(-50%); z-index:30; display:flex; flex-direction:column; gap:.5rem; font-family:'Share Tech Mono',monospace; font-size:.62rem; }
  /* Chapter menu: bold and bright (Brockmann, 2026-09-04: "Make the menu bar stronger, bold, to be very visible"). */
  .chap-link { color:var(--text); font-weight:700; text-shadow:0 1px 10px rgba(0,0,0,.9); text-decoration:none; letter-spacing:.25em; padding:.35rem .8rem; border:1px solid transparent; transition:all .3s; text-transform:uppercase; cursor:none; display:flex; align-items:center; gap:.6rem; }
  .chap-link::before { content:''; width:18px; height:2px; background:var(--text); transition:all .3s; }
  .chap-link:hover, .chap-link.active { color:var(--gold-champagne); border-color:rgba(201,168,76,.35); background:rgba(201,168,76,.04); }
  .chap-link.active::before, .chap-link:hover::before { width:28px; background:var(--gold); }
  .hud { position:fixed; z-index:20; font-family:'Share Tech Mono',monospace; font-size:.65rem; letter-spacing:.3em; opacity:.6; text-decoration:none; }
  .hud.tl { top:1.2rem; left:1.8rem; color:var(--gold-champagne); }
  .hud.tr { top:1.2rem; right:15rem; color:var(--text-mute); }
  .hud.bl { bottom:1.2rem; left:1.8rem; color:var(--text-mute); }
  .hud.br { bottom:1.2rem; right:1.8rem; color:var(--gold); }
  .progress { position:fixed; top:0; left:0; height:2px; width:0; background:linear-gradient(90deg, var(--gold-antique), var(--gold-bright), var(--copper)); z-index:100; box-shadow:0 0 14px rgba(201,168,76,.7); transition:width .1s linear; }
  .content { position:relative; z-index:5; }
  section.panel { min-height:100vh; display:flex; align-items:center; justify-content:center; padding:6rem 2rem; text-align:center; position:relative; }
  section.panel > div { width:100%; max-width:1200px; }
  .eyebrow { font-family:'Share Tech Mono',monospace; color:var(--gold-champagne); letter-spacing:.45em; font-size:.75rem; text-transform:uppercase; margin-bottom:1.6rem; opacity:0; transform:translateY(20px); transition:opacity 1s cubic-bezier(.25,.6,.25,1), transform 1s cubic-bezier(.25,.6,.25,1); }
  .eyebrow.in { opacity:1; transform:translateY(0); }
  h1.mega { font-family:'Orbitron',sans-serif; font-weight:900; font-size:clamp(2.6rem,7.2vw,6.6rem); letter-spacing:.02em; line-height:.95; margin-bottom:2rem; opacity:0; filter:blur(20px); transform:scale(1.15); transition:opacity 1.2s cubic-bezier(.2,.7,.2,1), filter 1.2s cubic-bezier(.2,.7,.2,1), transform 1.4s cubic-bezier(.2,.7,.2,1); }
  h1.mega.in { opacity:1; filter:blur(0); transform:scale(1); }
  .gold { background:linear-gradient(135deg, #BF953F 0%, #FCF6BA 50%, #B38728 100%); -webkit-background-clip:text; background-clip:text; -webkit-text-fill-color:transparent; }
  h1.mega .gold { text-shadow:0 0 80px rgba(201,168,76,.3); }
  h1.mega .white { color:var(--text); }
  h2.section-h { font-family:'Orbitron',sans-serif; font-weight:700; font-size:clamp(2rem,5vw,4.5rem); letter-spacing:.03em; margin-bottom:1.4rem; opacity:0; filter:blur(12px); transform:translateY(24px); transition:opacity 1s cubic-bezier(.25,.6,.25,1), filter 1s cubic-bezier(.25,.6,.25,1), transform 1s cubic-bezier(.25,.6,.25,1); }
  h2.section-h.in { opacity:1; filter:blur(0); transform:translateY(0); }
  .sub { font-size:clamp(1rem,1.3vw,1.25rem); color:var(--text-dim); max-width:720px; margin:0 auto 2.5rem; line-height:1.55; font-weight:300; opacity:0; transform:translateY(16px); transition:opacity 1s ease-out .3s, transform 1s ease-out .3s; }
  .sub.in { opacity:1; transform:translateY(0); }
  .sub, .eyebrow { text-shadow:0 1px 2px rgba(5,8,16,.7); }   /* over a photograph the descriptors need an edge at every size */
  .rise { opacity:0; transform:translateY(22px); transition:opacity 1s ease-out .35s, transform 1s ease-out .35s; }
  .rise.in { opacity:1; transform:translateY(0); }
  .cta, .cta-button { display:inline-block; padding:1.1rem 2.5rem; font-family:'Orbitron',sans-serif; font-weight:700; letter-spacing:.2em; font-size:.85rem; text-transform:uppercase; text-decoration:none; color:#000; background:linear-gradient(135deg, #BF953F 0%, #FCF6BA 50%, #B38728 100%); border:1px solid var(--gold-champagne); cursor:none; transition:transform .35s, box-shadow .35s; position:relative; overflow:hidden; border-radius:0; }
  .cta::before, .cta-button::before { content:''; position:absolute; top:0; left:-100%; width:100%; height:100%; background:linear-gradient(90deg, transparent, rgba(255,255,255,.4), transparent); transition:left .7s; }
  .cta:hover, .cta-button:hover { transform:translateY(-3px); box-shadow:0 14px 44px rgba(201,168,76,.5); }
  .cta:hover::before, .cta-button:hover::before { left:100%; }
  .cta-button[disabled] { opacity:.35; transform:none; box-shadow:none; }
  .secondary-cta, .cta-button.ghost-button { display:inline-block; padding:1.1rem 2.5rem; font-family:'Orbitron',sans-serif; font-weight:700; letter-spacing:.2em; font-size:.85rem; text-transform:uppercase; text-decoration:none; color:var(--gold-champagne); background:transparent; border:1px solid var(--gold); cursor:none; transition:all .35s; margin-left:1rem; }
  .secondary-cta:hover, .cta-button.ghost-button:hover { background:rgba(201,168,76,.08); border-color:var(--gold-bright); color:var(--gold-bright); transform:none; box-shadow:none; }
  .ctas { display:flex; gap:1rem; justify-content:center; flex-wrap:wrap; }
  .ctas .secondary-cta, .ctas .ghost-button { margin-left:0; }
  .badge { display:inline-block; padding:.45rem 1rem; border:1px solid var(--gold); font-family:'Share Tech Mono',monospace; font-size:.65rem; letter-spacing:.4em; color:var(--gold-champagne); margin-bottom:1.5rem; background:rgba(201,168,76,.06); backdrop-filter:blur(8px); }
  .chips { display:flex; flex-wrap:wrap; gap:.65rem; justify-content:center; max-width:1000px; margin:0 auto 2.5rem; }
  .chip { padding:.55rem 1rem; border:1px solid rgba(201,168,76,.35); background:rgba(30,42,58,.55); backdrop-filter:blur(6px); font-family:'Share Tech Mono',monospace; font-size:.65rem; letter-spacing:.25em; color:var(--gold-champagne); text-transform:uppercase; }
  .stats { display:grid; grid-template-columns:repeat(3,1fr); gap:1.8rem; max-width:980px; margin:3rem auto 0; }
  .stat { text-align:center; padding:2rem 1.5rem; border:1px solid rgba(201,168,76,.22); background:linear-gradient(180deg, rgba(30,42,58,.5) 0%, rgba(11,18,33,.7) 100%); backdrop-filter:blur(12px); position:relative; overflow:hidden; transition:transform .4s, border-color .4s; }
  .stat::before { content:''; position:absolute; top:0; left:0; width:100%; height:1px; background:linear-gradient(90deg, transparent, var(--gold), transparent); }
  .stat:hover { transform:translateY(-6px); border-color:var(--gold); }
  .stat-num { font-family:'Orbitron',sans-serif; font-weight:900; font-size:clamp(2.8rem,5.5vw,4.5rem); background:linear-gradient(135deg, #BF953F 0%, #FCF6BA 50%, #B38728 100%); -webkit-background-clip:text; background-clip:text; -webkit-text-fill-color:transparent; line-height:1; }
  .stat-label { font-family:'Share Tech Mono',monospace; font-size:.7rem; letter-spacing:.35em; color:var(--text-dim); margin-top:1rem; text-transform:uppercase; }
  /* Photo tiles: the trailer's glass pillars carrying the Federico and range photography */
  .tiles { display:grid; grid-template-columns:repeat(3,1fr); gap:1.2rem; max-width:1200px; margin:0 auto; }
  .tiles.four { grid-template-columns:repeat(4,1fr); }
  .tile { position:relative; min-height:300px; display:flex; align-items:flex-end; text-align:left; overflow:hidden; border:1px solid rgba(201,168,76,.22); background:var(--deep-navy); transition:transform .45s, border-color .45s; }
  .tile .bg { position:absolute; inset:0; background:center/cover no-repeat; transform:scale(1.04); transition:transform 5s ease; filter:saturate(.8); }
  .tile video.bg { width:100%; height:100%; object-fit:cover; }
  .tile:hover .bg { transform:scale(1.12); }
  .tile::after { content:''; position:absolute; inset:0; background:linear-gradient(180deg, rgba(5,8,16,.05) 0%, rgba(5,8,16,.35) 50%, rgba(5,8,16,.92) 100%); }
  .tile:hover { transform:translateY(-6px); border-color:var(--gold); }
  /* Shared card hover (Brockmann, 2026-09-04: "make sure that for any card or any function on the site ... we don't lose the
     consistency"): every card on either site lifts the same way on mouse-over. Add each new card class to these two selectors;
     the card's own rules only set its border colour. */
  .tile, .tier, .gear-card { transition:transform .45s, border-color .45s, box-shadow .45s; }   /* every card on either site takes this one hover (Brockmann, 2026-09-04) */
  .tile:hover, .tier:hover, .gear-card:hover { transform:translateY(-6px); }
  .tile .txt { position:relative; z-index:2; padding:1.4rem 1.3rem; width:100%; }
  .tile .num { font-family:'Share Tech Mono',monospace; font-size:.62rem; letter-spacing:.4em; color:var(--gold); margin-bottom:.5rem; }
  .tile h3 { font-family:'Orbitron',sans-serif; font-weight:700; font-size:1.15rem; color:var(--gold-champagne); letter-spacing:.04em; margin-bottom:.35rem; }
  .tile p { font-size:.92rem; color:var(--text-dim); line-height:1.5; font-weight:300; }
  .tiles.four .tile { min-height:260px; }
  /* Glass panel that carries the catalog */
  .glass { border:1px solid rgba(201,168,76,.22); background:linear-gradient(180deg, rgba(30,42,58,.45) 0%, rgba(11,18,33,.78) 100%); backdrop-filter:blur(14px); padding:1.4rem; text-align:left; position:relative; }
  .glass::before { content:''; position:absolute; top:0; left:0; right:0; height:1px; background:linear-gradient(90deg, transparent, var(--gold), transparent); }
  .catalog-wrap { max-width:960px; margin:0 auto; }
  .catalog-panel { max-height:none; }
  .cat { background:rgba(5,8,16,.35); }
  .course-row { color:var(--text); }
  .cr-btn { padding:.55rem 1rem; font-size:.72rem; }
  .cat-count { color:var(--text-dim); }
  .catalog-note { text-align:center; color:var(--text-dim); font-size:.92rem; margin-top:1.4rem; font-weight:300; }
  .catalog-note a { color:var(--gold-champagne); text-decoration:none; }
  /* Instructor */
  /* Portraits: one size for every person on the page, founder and team alike — the same column and a 4:5 frame that does not
     stretch with the bio beside it (Brockmann, 2026-09-05: "They're not all the same size … size them for consistency"). */
  .founder { display:grid; grid-template-columns:minmax(240px,380px) 1fr; gap:2.2rem; max-width:1150px; margin:0 auto; text-align:left; align-items:start; }
  .founder .portrait { position:relative; aspect-ratio:4/5; min-height:0; border:1px solid rgba(201,168,76,.3); background:center 20%/cover no-repeat; }
  .founder .portrait::after { content:''; position:absolute; inset:0; background:linear-gradient(180deg, transparent 55%, rgba(5,8,16,.9) 100%); }
  .founder .portrait .cap { position:absolute; left:1.2rem; bottom:1.1rem; z-index:2; font-family:'Share Tech Mono',monospace; font-size:.62rem; letter-spacing:.35em; color:var(--gold-champagne); text-transform:uppercase; }
  .founder .bio { border:1px solid rgba(201,168,76,.22); background:linear-gradient(180deg, rgba(30,42,58,.5) 0%, rgba(11,18,33,.75) 100%); backdrop-filter:blur(14px); padding:2rem 1.9rem; position:relative; }
  .founder .bio::before { content:''; position:absolute; top:0; left:0; width:3px; height:100%; background:linear-gradient(180deg, var(--gold), var(--copper)); }
  .founder .bio p { color:var(--text-dim); line-height:1.6; font-weight:300; font-size:1.05rem; margin-bottom:1.2rem; }
  .founder .creds { list-style:none; margin:0 0 1.4rem; padding:0; }
  .founder .creds li { padding:.45rem 0 .45rem 1.4rem; position:relative; color:var(--text); font-size:.98rem; line-height:1.5; border-top:1px solid rgba(201,168,76,.12); }
  .founder .creds li::before { content:'◆'; position:absolute; left:0; top:.55rem; color:var(--gold); font-size:.6rem; }
  .founder .creds b { color:var(--gold-champagne); font-weight:600; }
  .founder .cadre { font-family:'Share Tech Mono',monospace; font-size:.72rem; letter-spacing:.08em; color:var(--text-dim); line-height:1.7; margin-bottom:1.4rem; }
  .founder .ctas { justify-content:flex-start; }
  .cert { max-width:1150px; margin:1.4rem auto 0; display:grid; grid-template-columns:minmax(220px,360px) 1fr; gap:1.4rem; align-items:center; text-align:left; }
  .cert img { width:100%; border:1px solid rgba(201,168,76,.3); display:block; }
  .cert p { color:var(--text-dim); font-weight:300; line-height:1.55; font-size:.98rem; }
  /* Team blocks: the Atlas Glinn "Meet the Team" format (portrait + name, role, bio), shared by the MAST Instructors chapter. */
  .team { display:grid; grid-template-columns:minmax(240px,380px) 1fr; gap:2.2rem; max-width:1150px; margin:0 auto 1.6rem; text-align:left; align-items:start; }
  .team .portrait { aspect-ratio:4/5; min-height:0; border:1px solid rgba(201,168,76,.3); background:center 20%/cover no-repeat; position:relative; }
  .team .portrait::after { content:''; position:absolute; inset:0; background:linear-gradient(180deg, transparent 60%, rgba(5,8,16,.9) 100%); }
  .team .portrait .cap { position:absolute; left:1.1rem; bottom:1rem; z-index:2; font-family:'Share Tech Mono',monospace; font-size:.62rem; letter-spacing:.3em; color:var(--gold-champagne); text-transform:uppercase; }
  .team .bio { border:1px solid rgba(201,168,76,.22); background:linear-gradient(180deg, rgba(30,42,58,.5) 0%, rgba(11,18,33,.75) 100%); backdrop-filter:blur(14px); padding:1.8rem; position:relative; }
  .team .bio::before { content:''; position:absolute; top:0; left:0; width:3px; height:100%; background:linear-gradient(180deg, var(--gold), var(--copper)); }
  .team .bio h3, .founder .bio h3 { font-family:'Orbitron',sans-serif; font-weight:700; font-size:1.25rem; color:var(--gold-champagne); margin-bottom:.2rem; }
  .team .bio .role, .founder .bio .role { font-family:'Share Tech Mono',monospace; font-size:.65rem; letter-spacing:.3em; text-transform:uppercase; color:var(--text-dim); margin-bottom:1rem; }
  .team .bio p { color:var(--text-dim); line-height:1.6; font-weight:300; font-size:1.02rem; }
  /* Media strip */
  .media-strip { display:flex; overflow-x:auto; scroll-snap-type:x mandatory; gap:1rem; padding:.5rem 0 1rem; scrollbar-width:thin; scrollbar-color:var(--gold) var(--deep-navy); max-width:1200px; margin:0 auto; }
  .video-card { flex:0 0 min(82vw,480px); scroll-snap-align:start; background:rgba(11,18,33,.8); border:1px solid rgba(201,168,76,.22); overflow:hidden; text-align:left; }
  .yt .play { border-color:var(--gold); background:rgba(5,8,16,.8); }
  .yt:hover .play { background:var(--gold); border-color:var(--gold); }
  .yt.mp4 { background:linear-gradient(135deg, var(--gunmetal), var(--midnight)); }
  .yt.mp4 .lbl { color:var(--gold-champagne); font-family:'Share Tech Mono',monospace; }
  .video-card-info h4 { color:var(--gold-champagne); }
  .post { display:inline-block; margin-top:2rem; padding:1rem 1.8rem; border:1px solid var(--gold); background:rgba(201,168,76,.07); backdrop-filter:blur(8px); font-family:'Orbitron',sans-serif; font-weight:700; font-size:clamp(.85rem,1.2vw,1.05rem); letter-spacing:.14em; color:var(--gold-champagne); text-decoration:none; text-transform:uppercase; transition:all .35s; cursor:none; }
  .post:hover { background:rgba(201,168,76,.16); border-color:var(--gold-bright); color:var(--gold-bright); transform:translateY(-3px); }
  .post small { display:block; font-family:'Share Tech Mono',monospace; font-weight:400; font-size:.62rem; letter-spacing:.35em; color:var(--text-dim); margin-bottom:.35rem; }
  .quote { font-style:italic; color:var(--gold-champagne); max-width:700px; margin:.5rem auto 2rem; font-size:clamp(1.05rem,1.5vw,1.3rem); line-height:1.5; }
  .quote.lead { max-width:820px; font-size:clamp(1.2rem,1.9vw,1.55rem); margin-top:.8rem; }
  /* Contact lines sit over a backdrop photograph on both sites: full text colour and a shadow (Brockmann, 2026-09-05: "Fix the visibility of the contact"). */
  .contact-lines { font-family:'Share Tech Mono',monospace; font-size:.75rem; letter-spacing:.2em; color:var(--text); text-shadow:0 1px 6px rgba(0,0,0,.9), 0 0 22px rgba(0,0,0,.7); line-height:2.1; margin-bottom:2.2rem; }
  .contact-lines a { color:var(--gold-champagne); text-decoration:none; }
  .foot { margin-top:4rem; font-family:'Share Tech Mono',monospace; font-size:.62rem; letter-spacing:.3em; color:var(--text-mute); text-transform:uppercase; line-height:2.2; }
  .foot a { color:var(--text-mute); text-decoration:none; margin:0 .6rem; }
  .foot a:hover { color:var(--gold-champagne); }
  .scroll-cue { position:absolute; bottom:3rem; left:50%; transform:translateX(-50%); font-family:'Share Tech Mono',monospace; font-size:.65rem; color:var(--gold-champagne); letter-spacing:.4em; opacity:.55; animation:pulseY 2.4s ease-in-out infinite; }
  @keyframes pulseY { 50% { opacity:1; transform:translateX(-50%) translateY(-10px); } }
  /* Booking stack (lifted from the Atlas-frame pages, recolored to the trailer palette) */
"""

CSS_B = r"""
  .modal { background:var(--deep-navy); border-color:rgba(201,168,76,.4); }
  .modal .eyebrow { opacity:1; transform:none; margin-bottom:.6rem; }
  .modal h3 { color:var(--text); }
  .day.sel { background:var(--gold); border-color:var(--gold); color:#000; }
  .day.wk:hover { background:rgba(201,168,76,.25); border-color:var(--gold); }
  .cal-nav button:hover:not([disabled]) { background:var(--gold); color:#000; }
  .cal-quick button.on, .cal-quick .on { background:var(--gold); color:#000; border-color:var(--gold); }
  .qty button { cursor:none; }
  .sheet-date button { color:var(--gold-champagne); }
  input:focus { border-color:var(--gold) !important; }
  .banner { background:var(--gold); color:#000; }
  .quals-list li::marker, .quals-list li b { color:var(--gold-champagne); }
  @media (max-width:900px) { .founder, .cert, .team { grid-template-columns:1fr; } .founder .portrait, .team .portrait { max-width:380px; width:100%; margin:0 auto; } .tiles, .tiles.four { grid-template-columns:1fr 1fr; } }
  /* The fixed chapter nav on the right needs its own lane: at laptop widths keep the labels and give the panels a right
     margin; on tablets collapse the nav to its tick marks so the content keeps most of the width. */
  @media (min-width:1025px) and (max-width:1600px) { section.panel { padding-right:16.5rem; } }
  @media (min-width:769px) and (max-width:1024px) { section.panel { padding-right:4.5rem; } .chapter-nav { right:.8rem; gap:.35rem; } .chap-link { font-size:0; padding:.3rem .4rem; gap:0; } .chap-link::before { width:16px; } .chap-link.active::before, .chap-link:hover::before { width:22px; } }
  @media (max-width:768px) {
    html, body { cursor:auto; } .cta, .cta-button, .secondary-cta, .chap-link, .qty button { cursor:pointer; }
    .reticle, .chapter-nav { display:none; }
    .hud { font-size:.55rem; } .hud.tr, .hud.bl, .hud.br { display:none; }   /* phones keep only the top-left line; the section counter collided with it */
    .stats { grid-template-columns:1fr; gap:1rem; }
    .tiles, .tiles.four { grid-template-columns:1fr; } .tile, .tiles.four .tile { min-height:220px; }
    section.panel { padding:5rem 1rem; }
    .glass { padding:.8rem; }
    .secondary-cta, .cta-button.ghost-button { margin-left:0; }
    #photos .ph.on { opacity:.35; }
    #photos .ph.film.on { opacity:.5; }
    /* Phone legibility (Brockmann, 2026-09-05, iPhone screenshot of the MAST opening: "Text descriptors need to be fixed…
       hard to read"): full-strength text with a shadow, and a soft scrim behind each chapter's text block. */
    .sub { color:var(--text); font-weight:400; text-shadow:0 1px 3px rgba(5,8,16,.95), 0 0 18px rgba(5,8,16,.8); }
    h1.mega, h2.section-h, .eyebrow { text-shadow:0 2px 14px rgba(5,8,16,.9); }
    section.panel > div { padding:1.4rem .6rem; background:radial-gradient(ellipse at center, rgba(5,8,16,.62) 0%, rgba(5,8,16,.38) 55%, rgba(5,8,16,0) 80%); }
  }
  @media (prefers-reduced-motion: reduce) { .eyebrow, h1.mega, h2.section-h, .sub, .rise { transition:none; opacity:1; filter:none; transform:none; } }
"""

THREE_JS = r"""
import * as THREE from './vendor/three.module.js';

const SECTIONS = 9;
const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
const mobile = matchMedia('(max-width: 768px)').matches;

// ── Trailer intro ──
const intro = document.getElementById('intro-seq');
const openHero = () => {
  intro.remove();
  document.body.classList.add('cinema');
  setTimeout(() => document.body.classList.remove('cinema'), 2200);
  document.querySelector('[data-section="01"] .eyebrow').classList.add('in');
  setTimeout(() => document.querySelector('[data-section="01"] h1.mega').classList.add('in'), 300);
  setTimeout(() => document.querySelector('[data-section="01"] .sub').classList.add('in'), 900);
  setTimeout(() => document.querySelector('[data-section="01"] .rise').classList.add('in'), 1200);
  setPhoto(0);
};
if (reduce) { openHero(); } else {
  setTimeout(() => { intro.classList.add('done'); setTimeout(openHero, 1000); }, 4800);
}
// Gold ring (Brockmann, 2026-09-04: "the gold around the Atlas Glinn is what I was talking about ... take some of the gold shimmer
// and fade it in and fade it out"): the sparkle ring of the current atlasglinn.com intro — a tilted, slowly turning, pulsing ring
// of gold points — drawn in 2D around the wordmark. It fades in after the wordmark appears and out before the splash ends; the
// wordmark itself keeps the page palette. Always gold, on both sites.
const ring = document.getElementById('intro-ring');
if (ring && !reduce) {
  // rgb() on purpose: the ring is gold on every page, so these must not match the palette recolor's hex and rgba( tokens
  const g = ring.getContext('2d'), P = [], gold = ['rgb(201 168 76)', 'rgb(232 210 125)', 'rgb(252 246 186)', 'rgb(191 149 63)', 'rgb(212 175 55)'];
  const N = mobile ? 260 : 520;
  const pick = () => gold[Math.floor(Math.random() * gold.length)];
  for (let i = 0; i < N; i++) P.push({ a: Math.random() * Math.PI * 2, r: 1 + (Math.random() - .5) * .22, y: (Math.random() - .5) * .18, s: 1 + Math.random() * 2.2, c: pick(), o: .35 + Math.random() * .65, w: 1 + Math.random() * 2 });
  for (let i = 0; i < N / 3; i++) P.push({ a: Math.random() * Math.PI * 2, r: 1.15 + Math.random() * .6, y: (Math.random() - .5) * .5, s: 1 + Math.random() * 1.5, c: pick(), o: .15 + Math.random() * .4, w: 1 + Math.random() * 2 });
  const t0 = performance.now();
  const fade = t => t < .9 ? 0 : t < 1.9 ? t - .9 : t < 3.6 ? 1 : t < 4.6 ? 1 - (t - 3.6) : 0;
  const draw = () => {
    if (!ring.isConnected) return;
    const t = (performance.now() - t0) / 1000, W = ring.width = innerWidth, H = ring.height = innerHeight, k = fade(t);
    ring.style.opacity = k; g.clearRect(0, 0, W, H);
    if (t > 4.6) return;
    const R = Math.min(W, H) * (mobile ? .42 : .34), cx = W / 2, cy = H / 2, rot = t * .3, pulse = 1 + Math.sin(t * 3) * .02, tilt = .62 + Math.sin(t) * .06;
    for (const p of P) { const a = p.a + rot, x = cx + Math.cos(a) * R * p.r * pulse * 1.35, y = cy + Math.sin(a) * R * p.r * pulse * tilt + p.y * R; g.globalAlpha = p.o * (.7 + .3 * Math.sin(t * p.w * 2 + p.a * 7)); g.fillStyle = p.c; g.fillRect(x, y, p.s, p.s); }
    requestAnimationFrame(draw);
  };
  requestAnimationFrame(draw);
}

// ── Reticle ──
const reticle = document.querySelector('.reticle');
let cx = innerWidth / 2, cy = innerHeight / 2, rx = cx, ry = cy;
addEventListener('mousemove', e => { cx = e.clientX; cy = e.clientY; });

// ── Photography layer ──
const phs = [...document.querySelectorAll('#photos .ph')];
let photoIdx = -1;
function setPhoto(i) {
  if (i === photoIdx) return; photoIdx = i;
  phs.forEach((p, k) => {
    const on = k === i; p.classList.toggle('on', on);
    const v = p.querySelector('video');                            // film backdrops play only while their chapter is on screen
    if (v) { if (on && !reduce) v.play().catch(() => {}); else v.pause(); }
    const f = p.querySelector('iframe[data-src]');                 // YouTube backdrops load when their chapter arrives, unload when it leaves
    if (f) {
      if (on && !reduce) { if (!f.getAttribute('src')) { f.addEventListener('load', () => f.classList.add('playing'), { once: true }); f.src = f.dataset.src; } }
      else if (f.getAttribute('src')) { f.classList.remove('playing'); f.removeAttribute('src'); }
    }
  });
}
document.querySelectorAll('#photos video').forEach(v => {
  v.addEventListener('playing', () => v.classList.add('playing'));
  const end = parseFloat(v.dataset.end || '0');                    // data-end: loop the first N seconds of a longer file as the snippet
  if (end > 0) v.addEventListener('timeupdate', () => { if (v.currentTime >= end) v.currentTime = 0; });
});

// ── Three: the Tier 3 emblem scene ──
const canvas = document.getElementById('three-canvas');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: !mobile, alpha: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio, mobile ? 1.5 : 2));
renderer.setSize(innerWidth, innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.15;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x050810);
scene.fog = new THREE.FogExp2(0x0B1221, 0.03);
const camera = new THREE.PerspectiveCamera(45, innerWidth / innerHeight, 0.1, 1000);
camera.position.set(0, 0, 9);

// Lights — all warm
scene.add(new THREE.AmbientLight(0x1a1208, 0.5));
const keyL = new THREE.DirectionalLight(0xC9A84C, 3.0); keyL.position.set(6, 10, 7); scene.add(keyL);
const rimL = new THREE.DirectionalLight(0xB87333, 1.6); rimL.position.set(-7, -4, -5); scene.add(rimL);
const fillL = new THREE.DirectionalLight(0xE8D27D, 0.9); fillL.position.set(0, -8, 3); scene.add(fillL);
const pt = new THREE.PointLight(0xFCF6BA, 3.5, 18); pt.position.set(0, 0, 4); scene.add(pt);

// Reflective floor
const floor = new THREE.Mesh(new THREE.PlaneGeometry(140, 140, 40, 40),
  new THREE.MeshStandardMaterial({ color: 0x0B1221, metalness: .95, roughness: .28, emissive: 0x080808, emissiveIntensity: .15 }));
floor.rotation.x = -Math.PI / 2; floor.position.y = -4.5; scene.add(floor);

// Distant peaks
const peaks = new THREE.Group();
for (let i = 0; i < 11; i++) {
  const m = new THREE.Mesh(new THREE.ConeGeometry(2 + Math.random() * 2.2, 4.5 + Math.random() * 4, 5),
    new THREE.MeshStandardMaterial({ color: 0x0B1221, roughness: 1, metalness: 0 }));
  m.position.set(-34 + i * 7 + Math.random() * 3, -3.5, -23 - Math.random() * 7);
  m.rotation.y = Math.random() * Math.PI; peaks.add(m);
}
scene.add(peaks);

// Hero emblem: hexagonal shield, rings, bars, gem, shards
const emblem = new THREE.Group();
const gold = new THREE.MeshStandardMaterial({ color: 0xC9A84C, metalness: 1, roughness: .12, emissive: 0x2a1f08, emissiveIntensity: .4 });
const copper = new THREE.MeshStandardMaterial({ color: 0xB87333, metalness: 1, roughness: .18, emissive: 0x3a1a08, emissiveIntensity: .5 });
const champagne = new THREE.MeshStandardMaterial({ color: 0xE8D27D, metalness: 1, roughness: .1, emissive: 0x443311, emissiveIntensity: .8 });
const shield = new THREE.Mesh(new THREE.CylinderGeometry(2.3, 2.3, 0.4, 6), gold); shield.rotation.x = Math.PI / 2; emblem.add(shield);
const innerHex = new THREE.Mesh(new THREE.CylinderGeometry(1.75, 1.75, 0.45, 6), new THREE.MeshStandardMaterial({ color: 0x050810, metalness: .6, roughness: .4 }));
innerHex.rotation.x = Math.PI / 2; emblem.add(innerHex);
for (let i = 0; i < 3; i++) { const ring = new THREE.Mesh(new THREE.TorusGeometry(1.85 + i * .18, .028, 16, 128), i === 1 ? champagne : gold); ring.rotation.x = i * .08; ring.rotation.z = i * .08; emblem.add(ring); }
for (let i = 0; i < 3; i++) { const bar = new THREE.Mesh(new THREE.BoxGeometry(.12, 2.8, .12), gold); bar.rotation.z = (Math.PI / 3) * i; emblem.add(bar); }
emblem.add(new THREE.Mesh(new THREE.IcosahedronGeometry(.4, 1), copper));
const shards = [];
for (let i = 0; i < 10; i++) {
  const s = new THREE.Mesh(new THREE.OctahedronGeometry(.08, 0), i % 2 ? champagne : gold);
  s.userData = { a: (Math.PI * 2 * i) / 10, r: 2.6 + Math.random() * .5, sp: .4 + Math.random() * .3 };
  emblem.add(s); shards.push(s);
}
scene.add(emblem);

// God rays
const rays = new THREE.Group();
for (let i = 0; i < 14; i++) {
  const r = new THREE.Mesh(new THREE.ConeGeometry(.08, 16, 8, 1, true),
    new THREE.MeshBasicMaterial({ color: 0xC9A84C, transparent: true, opacity: .04, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, depthWrite: false }));
  r.rotation.z = (Math.PI * 2 * i) / 14; r.position.z = -2; rays.add(r);
}
scene.add(rays);

// Particles: gold dust + champagne sparks
function pts(count, color, size, range) {
  const g = new THREE.BufferGeometry(); const p = new Float32Array(count * 3), v = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) { p[i*3] = (Math.random() - .5) * range; p[i*3+1] = (Math.random() - .5) * range * .7; p[i*3+2] = (Math.random() - .5) * range; v[i*3] = (Math.random() - .5) * .002; v[i*3+1] = (Math.random() - .5) * .002; v[i*3+2] = (Math.random() - .5) * .002; }
  g.setAttribute('position', new THREE.BufferAttribute(p, 3));
  const o = new THREE.Points(g, new THREE.PointsMaterial({ color, size, transparent: true, opacity: .65, blending: THREE.AdditiveBlending, depthWrite: false }));
  o.userData = { v }; return o;
}
const gd = pts(mobile ? 220 : 600, 0xC9A84C, .035, 40), ch = pts(mobile ? 60 : 150, 0xE8D27D, .028, 30);
scene.add(gd); scene.add(ch);

// Stars
const sg = new THREE.BufferGeometry(); const sp = new Float32Array(2200 * 3);
for (let i = 0; i < 2200; i++) { const r = 80 + Math.random() * 40, th = Math.random() * Math.PI * 2, ph = Math.acos(2 * Math.random() - 1); sp[i*3] = r * Math.sin(ph) * Math.cos(th); sp[i*3+1] = r * Math.cos(ph); sp[i*3+2] = r * Math.sin(ph) * Math.sin(th); }
sg.setAttribute('position', new THREE.BufferAttribute(sp, 3));
const stars = new THREE.Points(sg, new THREE.PointsMaterial({ color: 0xF0F4FF, size: .15, transparent: true, opacity: .5 }));
scene.add(stars);

// Scroll-driven camera: one keyframe per chapter
const secs = document.querySelectorAll('section.panel');
const chapLinks = document.querySelectorAll('.chap-link');
const lerp = (a, b, t) => a + (b - a) * t;
const kf = [
  { x: 0, y: 0, z: 9, lx: 0, ly: 0, lz: 0 },
  { x: 3, y: 1, z: 11, lx: 0, ly: 0, lz: 0 },
  { x: -3, y: 2, z: 13, lx: 0, ly: -1, lz: 0 },
  { x: 4, y: 3, z: 14, lx: 0, ly: -.5, lz: 0 },
  { x: -4, y: 1, z: 12, lx: 0, ly: 0, lz: 0 },
  { x: 0, y: -2, z: 10, lx: 0, ly: .5, lz: 0 },
  { x: 2, y: -3, z: 13, lx: 0, ly: 1, lz: 0 },
  { x: -2, y: -3.5, z: 15, lx: 0, ly: 1.5, lz: 0 },
  { x: 0, y: -4, z: 18, lx: 0, ly: 2, lz: 0 },
];
let activeIdx = 0;
function sectionIndex() {
  const mid = innerHeight * .45; let idx = 0;
  secs.forEach((s, i) => { if (s.getBoundingClientRect().top <= mid) idx = i; });
  return idx;
}
function update() {
  const total = document.documentElement.scrollHeight - innerHeight;
  const t = Math.max(0, Math.min(1, scrollY / Math.max(1, total)));
  const sc = t * (kf.length - 1), i = Math.floor(sc), f = sc - i;
  const a = kf[i], b = kf[Math.min(i + 1, kf.length - 1)];
  camera.position.set(lerp(a.x, b.x, f), lerp(a.y, b.y, f), lerp(a.z, b.z, f));
  camera.lookAt(lerp(a.lx, b.lx, f), lerp(a.ly, b.ly, f), lerp(a.lz, b.lz, f));
  const now = performance.now();
  emblem.rotation.y += 0.004; emblem.rotation.x = Math.sin(now * .0004) * .14;
  shards.forEach(s => { const ang = s.userData.a + now * .0002 * s.userData.sp; s.position.set(Math.cos(ang) * s.userData.r, Math.sin(ang * 1.3) * .6, Math.sin(ang) * s.userData.r); s.rotation.x += .02; s.rotation.y += .015; });
  rays.rotation.z += .001;
  emblem.position.y = -t * 2; emblem.scale.setScalar(1 - t * .25);
  [gd, ch].forEach(p => { const pos = p.geometry.attributes.position.array, v = p.userData.v; for (let k = 0; k < pos.length; k++) pos[k] += v[k]; p.geometry.attributes.position.needsUpdate = true; });
  gd.rotation.y = t * .3; ch.rotation.y = -t * .2; stars.rotation.y += .0002;
  scene.fog.density = 0.03 + t * .025;
  document.getElementById('progress').style.width = (t * 100) + '%';
  const idx = sectionIndex();
  if (idx !== activeIdx) { activeIdx = idx; document.getElementById('hud-section').textContent = `SECTION 0${idx + 1} / 0${SECTIONS}`; chapLinks.forEach((l, k) => l.classList.toggle('active', k === idx)); }
  if (!intro.isConnected) setPhoto(idx);
}
addEventListener('scroll', update, { passive: true });
addEventListener('resize', () => { camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); renderer.setSize(innerWidth, innerHeight); });
let mx = 0;
addEventListener('mousemove', e => { mx = (e.clientX / innerWidth - .5) * 2; });
let paused = false;
document.addEventListener('visibilitychange', () => { paused = document.hidden; if (!paused) animate(); });
function animate() {
  if (paused) return;
  requestAnimationFrame(animate);
  emblem.position.x += (mx * .4 - emblem.position.x) * .04;
  rx = lerp(rx, cx, .22); ry = lerp(ry, cy, .22);
  reticle.style.transform = `translate(${rx}px,${ry}px) translate(-50%,-50%)`;
  update(); renderer.render(scene, camera);
}
animate();

// Reveals, counters, trailer cuts
const io = new IntersectionObserver(entries => {
  entries.forEach(e => {
    if (!e.isIntersecting) return;
    if (e.target.dataset.section !== '01' && !reduce) { document.body.classList.add('cinema'); setTimeout(() => document.body.classList.remove('cinema'), 1600); }
    e.target.querySelectorAll('.eyebrow, h2.section-h, .sub, h1.mega, .rise').forEach(el => el.classList.add('in'));
    e.target.querySelectorAll('.stat-num[data-count]').forEach(el => {
      if (el.dataset.done) return; el.dataset.done = '1';
      const target = +el.dataset.count, duration = 1600, start = performance.now(), suffix = el.dataset.suffix || '';
      const tick = now => { const p = Math.min(1, (now - start) / duration); const eased = 1 - Math.pow(1 - p, 3); el.textContent = Math.floor(target * eased).toLocaleString('en-US') + suffix; if (p < 1) requestAnimationFrame(tick); };
      requestAnimationFrame(tick);
    });
  });
}, { threshold: .25 });
secs.forEach(s => io.observe(s));
// A tall chapter in a short window never reaches 25% visible (owner, 2026-09-05: Instructors blank on a Retina Mac at 1000×508
// CSS px), so every reveal element is also observed on its own and turns on as soon as it enters the lower part of the window.
const ioEl = new IntersectionObserver(entries => {
  entries.forEach(e => { if (!e.isIntersecting) return; e.target.classList.add('in'); ioEl.unobserve(e.target); });
}, { threshold: 0, rootMargin: '0px 0px -12% 0px' });
document.querySelectorAll('section.panel:not([data-section="01"]) .rise, section.panel:not([data-section="01"]) .eyebrow, section.panel:not([data-section="01"]) h2.section-h, section.panel:not([data-section="01"]) .sub').forEach(el => ioEl.observe(el));
"""

# ── Palettes: MAST is the reference (gold); ATLAS swaps every gold token for the Atlas Glinn blue. ──
MAST = {}
ATLAS = {
    # CSS gradients and text (gold → Atlas blue)
    '#BF953F': '#1558B8', '#FCF6BA': '#DCEBFF', '#B38728': '#0F4AA8', '#FBF5B7': '#CFE2FF', '#AA771C': '#0B3A85',
    '#C9A84C': '#1A6BDE', '#D4AF37': '#2F7BEF', '#E8D27D': '#5B9BFF', '#B87333': '#0E3F8C',
    'rgba(201,168,76,': 'rgba(26,107,222,',
    # three.js material and light colors
    '0xC9A84C': '0x1A6BDE', '0xB87333': '0x0E3F8C', '0xE8D27D': '0x5B9BFF', '0xFCF6BA': '0xDCEBFF',
    '0x2a1f08': '0x081a3a', '0x3a1a08': '0x071535', '0x443311': '0x112a55', '0x1a1208': '0x0a1020',
}


def _recolor(text, palette):
    for k, v in palette.items():
        text = text.replace(k, v)
    return text


def css(palette=MAST, booking_css='', extra=''):
    """The shell stylesheet. booking_css is spliced where the MAST page splices its booking stack; extra is appended."""
    return _recolor(CSS_A + booking_css + CSS_B, palette) + extra


_KF = [
    (0, 0, 9, 0, 0, 0), (3, 1, 11, 0, 0, 0), (-3, 2, 13, 0, -1, 0), (4, 3, 14, 0, -.5, 0), (-4, 1, 12, 0, 0, 0),
    (0, -2, 10, 0, .5, 0), (2, -3, 13, 0, 1, 0), (-2, -3.5, 15, 0, 1.5, 0), (0, -4, 18, 0, 2, 0),
]


def _fmt(v):
    s = ('%g' % v)
    return s.replace('0.', '.') if s.startswith('0.') or s.startswith('-0.') else s


def _keyframes(n):
    frames = [_KF[0]] + [_KF[1 + (i % 7)] for i in range(max(0, n - 2))] + ([_KF[8]] if n > 1 else [])
    names = ('x', 'y', 'z', 'lx', 'ly', 'lz')
    return '\n'.join('  { ' + ', '.join(k + ': ' + _fmt(v) for k, v in zip(names, f)) + ' },' for f in frames)


def three(sections=9, palette=MAST):
    """The module script body. Nine chapters is the MAST reference verbatim; other counts get a generated camera path."""
    js = THREE_JS
    if sections != 9:
        js = js.replace('const SECTIONS = 9;', 'const SECTIONS = %d;' % sections)
        a = js.index('const kf = [\n') + len('const kf = [\n')
        b = js.index('\n];', a)
        js = js[:a] + _keyframes(sections) + js[b:]
        js = js.replace("`SECTION 0${idx + 1} / 0${SECTIONS}`",
                        "`SECTION ${String(idx + 1).padStart(2, '0')} / ${String(SECTIONS).padStart(2, '0')}`")
    return _recolor(js, palette)


def head(meta_html, css_text):
    return ('<!DOCTYPE html>\n<html lang="en">\n<head>\n<meta charset="UTF-8">\n'
            '<meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover">\n'
            + meta_html + '<style>' + css_text + '</style>\n</head>\n<body>\n')


def chrome(credits, wordmark, photos, hud_tl, hud_tl_href, hud_bl, hud_br, chapters):
    """credits: (line before, line after) the wordmark; photos: [(num, image path, position or None[, mp4[, loop end seconds]])];
    chapters: [(id, label)]. A photo entry with an mp4 is a film backdrop: the still is its poster, the clip loops muted."""
    n = len(chapters)
    def layer(entry):
        num, img, pos, *film = entry
        style = 'background-image:url(\'%s\')%s' % (img, (';background-position:' + pos) if pos else '')
        if not film: return '  <div class="ph" data-for="%s" style="%s"></div>' % (num, style)
        mp4, end = (film + [None])[:2]
        if mp4.startswith('yt:'):   # a YouTube film, embedded with the same parameters the current site uses for its hero
            vid = mp4[3:]
            return ('  <div class="ph film yt" data-for="%s" style="%s"><iframe data-src="https://www.youtube.com/embed/%s?autoplay=1&amp;mute=1&amp;loop=1&amp;playlist=%s&amp;controls=0&amp;showinfo=0&amp;modestbranding=1&amp;rel=0&amp;playsinline=1&amp;iv_load_policy=3&amp;disablekb=1" '
                    'title="" tabindex="-1" aria-hidden="true" allow="autoplay; encrypted-media" referrerpolicy="strict-origin-when-cross-origin"></iframe></div>' % (num, style, vid, vid))
        return ('  <div class="ph film" data-for="%s" style="%s"><video muted loop playsinline preload="metadata" aria-hidden="true"%s>'
                '<source src="%s" type="video/mp4"></video></div>' % (num, style, (' data-end="%s"' % end) if end else '', mp4))
    ph = '\n'.join(layer(e) for e in photos)
    nav = '\n'.join('  <a href="#%s" class="chap-link">%s</a>' % (cid, label) for cid, label in chapters)
    return ('<div id="intro-seq">\n  <div class="intro-credit">%s</div>\n  <div class="intro-credit wordmark">%s</div>\n'
            '  <div class="intro-credit">%s</div>\n  <canvas class="intro-ring" id="intro-ring" aria-hidden="true"></canvas>\n</div>\n\n<canvas id="three-canvas"></canvas>\n<div id="photos">\n%s\n</div>\n'
            '<div class="grain"></div>\n<div class="vignette"></div>\n<div class="letterbox-top"></div>\n<div class="letterbox-bottom"></div>\n'
            '<div class="progress" id="progress"></div>\n<div class="reticle"><div class="reticle-ring"></div><div class="reticle-dot"></div></div>\n\n'
            '<a class="hud tl" href="%s">%s</a>\n<div class="hud tr" id="hud-section">SECTION 01 / %02d</div>\n'
            '<div class="hud bl">%s</div>\n<div class="hud br">%s</div>\n\n'
            '<nav class="chapter-nav" id="chapter-nav" aria-label="Chapters">\n%s\n</nav>\n'
            % (credits[0], wordmark, credits[1], ph, hud_tl_href, hud_tl, n, hud_bl, hud_br, nav))


# The Google listing (Atlas Glinn, LLC; MAST is its division). Feature id 0x8640c3cb2d0755df:0x3e9cfce1d8a7b9f7, CID
# 4511758973651106295, read out of the Business Profile link Brockmann pasted 2026-09-06 ("add to email as click + link +
# add to website"). "#lrd=<ftid>,3" opens the write-a-review dialog; the Maps CID URL is the listing itself (JSON-LD sameAs).
GOOGLE_REVIEW_URL = 'https://www.google.com/search?q=Atlas+Glinn&ludocid=4511758973651106295#lrd=0x8640c3cb2d0755df:0x3e9cfce1d8a7b9f7,3'
GOOGLE_MAPS_URL = 'https://maps.google.com/?cid=4511758973651106295'
REVIEW_LINK = f'<a href="{GOOGLE_REVIEW_URL}" target="_blank" rel="noopener" data-track="review">Google Reviews</a>'


def tile(num, title, body, img, pos='center', clip=''):
    """A chapter tile. With `clip` (Brockmann, 2026-09-06: "Medical vid is not in Medical class") the background is the
    muted, looping teaser with `img` as its poster; the shared .bg hover zoom applies to the video the same way."""
    if clip:
        bg = ('<video class="bg" autoplay muted loop playsinline preload="metadata" poster="%s" style="object-position:%s" aria-hidden="true">'
              '<source src="%s" type="video/mp4"></video>' % (img, pos, clip))
    else:
        bg = '<div class="bg" style="background-image:url(\'%s\');background-position:%s"></div>' % (img, pos)
    return ('<div class="tile rise">' + bg +
            '<div class="txt"><div class="num">%s</div><h3>%s</h3><p>%s</p></div></div>' % (num, title, body))


# First-party tracker (CRM, Brockmann 2026-09-06: "CRM should collect data - and much more"). No third party: the page keeps
# its first touch (UTM, referrer, landing page, a random visitor id) in localStorage, sends one view per page and the moments
# that lead to a seat to the Worker's /event, and hands the same attribution to every form post as `attribution`.
# `mastAttribution()` and `mastTrack(action, label, sku)` are globals for the booking script; clicks on [data-track] and
# every <video> play are picked up here.
TRACK_JS = r"""
(function () {
  var API = 'https://mast-booking-backend.matthew-221.workers.dev';
  var KEY = 'mast_first_touch', VKEY = 'mast_visitor';
  function store(k, v) { try { localStorage.setItem(k, v); } catch (e) {} }
  function read(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  var visitor = read(VKEY);
  if (!visitor) { visitor = 'v_' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36); store(VKEY, visitor); }
  var first = null; try { first = JSON.parse(read(KEY) || 'null'); } catch (e) {}
  var q = new URLSearchParams(location.search), utm = {};
  ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term'].forEach(function (k) { if (q.get(k)) utm[k] = q.get(k).slice(0, 120); });
  if (!first || (Object.keys(utm).length && !first.utm_source)) {
    first = Object.assign({ referrer: (document.referrer || '').slice(0, 500), landing_page: location.href.split('#')[0].slice(0, 500), first_touch_at: new Date().toISOString() }, utm);
    store(KEY, JSON.stringify(first));
  }
  window.mastAttribution = function () { return Object.assign({ visitor: visitor, page: location.href.split('#')[0].slice(0, 500) }, first || {}); };
  var sent = {};
  window.mastTrack = function (action, label, sku) {
    var key = action + '|' + (label || '') + '|' + (sku || '');
    if (action !== 'view' && sent[key]) return; sent[key] = 1;
    var body = JSON.stringify({ action: action, label: label || '', sku: sku || '', attribution: window.mastAttribution() });
    try { if (navigator.sendBeacon && navigator.sendBeacon(API + '/event', new Blob([body], { type: 'text/plain' }))) return; } catch (e) {}
    try { fetch(API + '/event', { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: body, keepalive: true }); } catch (e) {}
  };
  function ready() {
    mastTrack('view', document.title.slice(0, 120));
    document.addEventListener('click', function (e) {
      var el = e.target && e.target.closest ? e.target.closest('[data-track], a[href*="instagram.com"], a[href*="linkedin.com"], a[href*="youtube.com"]') : null;
      if (!el) return;
      if (el.dataset && el.dataset.track) { var p = el.dataset.track.split(':'); mastTrack(p[0], p[1] || el.textContent.trim().slice(0, 80), p[2] || ''); }
      else mastTrack('follow', (el.href.match(/instagram|linkedin|youtube/) || ['social'])[0]);
    }, true);
    document.addEventListener('play', function (e) { var v = e.target; if (v && v.tagName === 'VIDEO') mastTrack('video_play', (v.currentSrc || v.src || '').split('/').pop().slice(0, 80)); }, true);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', ready); else ready();
})();
"""


def tail(three_js, classic_js=''):
    return ('\n<script type="module">' + three_js + '</script>\n'
            + ('<script>' + classic_js + '</script>\n' if classic_js else '')
            + '<script>' + TRACK_JS + '</script>\n' + '</body>\n</html>\n')


# ── Site navigation for the multi-page Atlas Glinn build: a MENU control in the HUD row and a full-screen overlay. ──
# Mobile first: the overlay is a single column of large targets; on desktop it is a two-column grid.
SITENAV_CSS = r"""
  .menu-btn { position:fixed; top:.95rem; right:1.8rem; z-index:9500; font-family:'Share Tech Mono',monospace; font-size:.65rem; letter-spacing:.35em; color:var(--gold-champagne); background:rgba(5,8,16,.55); border:1px solid rgba(201,168,76,.4); padding:.5rem .9rem .5rem 1.1rem; cursor:none; backdrop-filter:blur(8px); text-transform:uppercase; }
  .menu-btn:hover { background:rgba(201,168,76,.12); border-color:var(--gold); }
  .sitenav { position:fixed; inset:0; z-index:9400; background:rgba(5,8,16,.94); backdrop-filter:blur(14px); display:flex; align-items:center; justify-content:center; opacity:0; visibility:hidden; transition:opacity .35s, visibility .35s; }
  .sitenav.open { opacity:1; visibility:visible; }
  .sitenav-in { width:min(920px, 100%); padding:5rem 1.5rem 3rem; text-align:left; }
  .sitenav .eyebrow { opacity:1; transform:none; margin-bottom:1.2rem; }
  .sitenav ul { list-style:none; margin:0; padding:0; display:grid; grid-template-columns:1fr 1fr; gap:.4rem 2rem; }
  .sitenav a { display:block; padding:.75rem 0; font-family:'Orbitron',sans-serif; font-weight:700; font-size:clamp(1rem,1.6vw,1.25rem); letter-spacing:.06em; color:var(--text); text-decoration:none; border-bottom:1px solid rgba(201,168,76,.15); cursor:none; transition:color .25s, padding-left .25s; }
  .sitenav a small { display:block; font-family:'Share Tech Mono',monospace; font-weight:400; font-size:.6rem; letter-spacing:.3em; color:var(--text-mute); text-transform:uppercase; margin-top:.2rem; }
  .sitenav a:hover, .sitenav a.here { color:var(--gold-champagne); padding-left:.4rem; }
  .sitenav .foot { margin-top:2rem; text-align:left; }
  .hud.tr { right:8.5rem; }
  @media (max-width:768px) { .menu-btn { top:.8rem; right:1rem; cursor:pointer; } .sitenav a { cursor:pointer; padding:.85rem 0; } .sitenav ul { grid-template-columns:1fr; gap:0; } .sitenav-in { padding:4.5rem 1.2rem 2rem; max-height:100vh; overflow-y:auto; } .hud.tr { display:none; } }
"""

SITENAV_JS = r"""
(function(){
  const nav = document.getElementById('sitenav'), btn = document.getElementById('menu-btn');
  if (!nav || !btn) return;
  const set = open => { nav.classList.toggle('open', open); btn.textContent = open ? 'CLOSE ×' : 'MENU ≡'; btn.setAttribute('aria-expanded', open); document.body.style.overflow = open ? 'hidden' : ''; };
  btn.addEventListener('click', () => set(!nav.classList.contains('open')));
  nav.addEventListener('click', e => { if (e.target === nav || e.target.closest('a')) set(false); });
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && nav.classList.contains('open')) set(false); });
})();
"""


def sitenav(links, here, foot_html=''):
    """links: [(href, label, sublabel)]; here: the current page href (marked)."""
    items = '\n'.join('      <li><a href="%s"%s>%s<small>%s</small></a></li>' % (h, ' class="here"' if h == here else '', l, s) for h, l, s in links)
    return ('<button class="menu-btn" id="menu-btn" type="button" aria-controls="sitenav" aria-expanded="false">MENU &#8801;</button>\n'
            '<div class="sitenav" id="sitenav" role="dialog" aria-label="Site menu">\n  <div class="sitenav-in">\n    <div class="eyebrow">Atlas Glinn, LLC &middot; Houston</div>\n    <ul>\n'
            + items + '\n    </ul>\n' + ('    <div class="foot">' + foot_html + '</div>\n' if foot_html else '') + '  </div>\n</div>\n')
