(() => {
  const gallery = document.getElementById('foto-clinica');
  let slides = [...gallery.querySelectorAll('.photo-slide')];
  const caption = gallery.querySelector('.photo-caption');
  const postLink = gallery.querySelector('.photo-post');
  const controls = gallery.querySelector('.photo-tools');
  const playback = controls.querySelector('[data-action="playback"]');
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  const interval = 6000;
  let index = 0;
  let playing = !reducedMotion.matches;
  let onScreen = true;
  let timer;

  function schedule() {
    clearTimeout(timer);
    if (playing && onScreen && !document.hidden) {
      timer = setTimeout(() => show(index + 1), interval);
    }
  }

  function setPlaying(value) {
    playing = value;
    const label = playing ? 'Sospendi la rotazione' : 'Avvia la rotazione';
    playback.setAttribute('aria-label', label);
    playback.title = label;
    playback.classList.toggle('paused', !playing);
    caption.setAttribute('aria-live', playing ? 'off' : 'polite');
    schedule();
  }

  function show(nextIndex) {
    index = (nextIndex + slides.length) % slides.length;
    slides.forEach((slide, i) => {
      slide.classList.toggle('current', i === index);
      slide.setAttribute('aria-hidden', String(i !== index));
    });
    const post = slides[index].dataset;
    caption.textContent = post.caption;
    postLink.href = post.post;
    const network = new URL(post.post).hostname === 'www.instagram.com' ? 'Instagram' : 'Facebook';
    postLink.textContent = 'Leggi su ' + network;
    postLink.setAttribute('aria-label', postLink.textContent + ': ' + post.caption);
    schedule();
  }

  function step(direction) {
    setPlaying(false);
    show(index + direction);
  }

  controls.querySelector('[data-action="prev"]').addEventListener('click', () => step(-1));
  controls.querySelector('[data-action="next"]').addEventListener('click', () => step(1));
  playback.addEventListener('click', () => setPlaying(!playing));
  gallery.addEventListener('focusin', event => {
    if (event.target.matches(':focus-visible')) setPlaying(false);
  });
  controls.addEventListener('keydown', event => {
    if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
      event.preventDefault();
      step(event.key === 'ArrowLeft' ? -1 : 1);
    }
  });
  reducedMotion.addEventListener('change', event => {
    if (event.matches) setPlaying(false);
  });
  document.addEventListener('visibilitychange', schedule);
  if ('IntersectionObserver' in window) {
    new IntersectionObserver(([entry]) => {
      onScreen = entry.isIntersecting;
      schedule();
    }).observe(gallery);
  }

  async function loadFeed() {
    const response = await fetch('feed/posts.json', { signal: AbortSignal.timeout(5000) });
    if (!response.ok) return;
    const { posts } = await response.json();
    if (!Array.isArray(posts) || !posts.length) return;

    const nextSlides = posts.map(post => {
      const image = document.createElement('img');
      image.className = 'photo-slide';
      image.alt = post.caption;
      image.dataset.caption = post.caption;
      image.dataset.post = post.url;
      image.src = post.image;
      return image;
    });
    await nextSlides[0].decode();
    if (gallery.contains(document.activeElement) || !playing && index !== 0) return;

    gallery.querySelector('.photo-stage').replaceChildren(...nextSlides);
    slides = nextSlides;
    controls.hidden = slides.length < 2;
    show(0);
  }

  if (location.protocol !== 'file:') loadFeed().catch(() => {});

  controls.hidden = false;
  setPlaying(playing);
})();
