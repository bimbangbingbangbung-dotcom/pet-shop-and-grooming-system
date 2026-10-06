'use strict';

/**
 * Seed data for Snip & Snout. Run `npm run seed` to rebuild from scratch,
 * or just start the server: seeding happens automatically when the database
 * is empty.
 *
 * Money is stored in pence (integer). Never floats.
 */

const crypto = require('node:crypto');
const { db } = require('./db');

const CATEGORIES = [
  ['food', 'Food & nutrition', 1],
  ['treats', 'Treats & chews', 2],
  ['toys', 'Toys', 3],
  ['grooming', 'Grooming kit', 4],
  ['walk', 'Walk kit', 5],
  ['beds', 'Beds & blankets', 6],
];

const PRODUCTS = [
  {
    slug: 'harvest-grain-free-kibble', name: 'Harvest Grain-Free Kibble', category: 'food',
    price_cents: 2490, art: 'bag', size: '2 kg', stock: 40, featured: 1,
    blurb: 'Chicken, squash and a lot of forgiveness for fussy eaters.',
    description: 'A single-protein dry food built for dogs whose stomachs have opinions. Grain-free, no colourings, and a kibble size that does not turn to dust in the bag.',
    detail: 'Composition: chicken 62%, squash, peas, salmon oil. Analytical: protein 28%, fat 16%, fibre 3.5%. Feed twice daily; adjust to body condition.',
  },
  {
    slug: 'slow-cooked-liver-pate', name: 'Slow-Cooked Liver Pâté', category: 'food',
    price_cents: 240, art: 'tin', size: '400 g', stock: 120,
    blurb: 'For the dog who reads the ingredient label.',
    description: 'Steam-cooked in small batches, nothing poured in to bulk it out. Opens easily, spoons out cleanly, keeps three days in the fridge.',
    detail: 'Composition: beef liver 71%, beef stock, carrot. No grains, no gelatine, no added sugar.',
  },
  {
    slug: 'wild-salmon-oil', name: 'Wild Salmon Oil Drizzle', category: 'food',
    price_cents: 1400, art: 'bottle', size: '250 ml', stock: 32,
    blurb: 'One pump on dinner for a coat that catches the light.',
    description: 'Cold-pressed, human-grade, with a pump that measures a single dose. Omega-3 and omega-6 for skin, coat and joints.',
    detail: 'One pump (2 ml) per 10 kg of body weight, over food. Refrigerate after opening.',
  },
  {
    slug: 'dental-chew-sticks', name: 'Dental Chew Sticks', category: 'treats',
    price_cents: 1200, art: 'treat', size: '30 sticks', stock: 54,
    blurb: 'The daily chore they will actually queue up for.',
    description: 'Ridged chews that flex against the tooth as they are worked, plus a parsley note for the aftermath of a close conversation.',
    detail: 'Wheat-free. Suitable from 12 weeks. One stick per day, always with fresh water available.',
  },
  {
    slug: 'peanut-butter-biscuits', name: 'Peanut Butter Biscuits', category: 'treats',
    price_cents: 650, art: 'treat', size: '250 g', stock: 0,
    blurb: 'Baked Tuesdays in the back of the shop.',
    description: 'Three ingredients, one tray, no xylitol ever. The biscuits the grooming table is bribed with.',
    detail: 'Composition: oat flour, peanut butter, egg. Store in a tin for up to two weeks.',
  },
  {
    slug: 'squeaky-avocado', name: 'Squeaky Avocado', category: 'toys',
    price_cents: 850, art: 'toy', size: '14 cm', stock: 24, featured: 1,
    blurb: 'A fruit nobody should eat, in a form everybody wants.',
    description: 'Thick rubber shell, recessed squeaker, and a stone in the middle that makes it satisfyingly lopsided when thrown.',
    detail: 'Dishwasher safe. Inspect weekly and retire when the squeaker shows through.',
  },
  {
    slug: 'braided-rope-tug', name: 'Braided Rope Tug', category: 'toys',
    price_cents: 1100, art: 'rope', size: '32 cm', stock: 18,
    blurb: 'For the game of tug that has rules.',
    description: 'Six-strand cotton with knotted ends, machine washable, and short enough that no one gets an elbow in the eye.',
    detail: 'Cotton with a jute core. Machine wash at 30°C and air dry.',
  },
  {
    slug: 'tennis-ball-tub', name: 'Tennis Ball Tub', category: 'toys',
    price_cents: 900, art: 'ball', size: '6 balls', stock: 30,
    blurb: 'Because one is never the number.',
    description: 'Six non-abrasive balls sized for dogs — properly sized, not human tennis balls, which wear tooth enamel down.',
    detail: 'Diameter 6.5 cm. Non-abrasive felt, safe for teeth.',
  },
  {
    slug: 'oat-aloe-shampoo', name: 'Oat & Aloe Shampoo', category: 'grooming',
    price_cents: 1350, art: 'bottle', size: '500 ml', stock: 46, featured: 1,
    blurb: 'The same bottle we use at the tub.',
    description: 'Soap-free, pH matched for canine skin, and diluted before it reaches the coat. Rinses fast, which is the whole trick.',
    detail: 'Dilute 1:8 in warm water. Leave two minutes, rinse thoroughly, repeat if the dog came in via a puddle.',
  },
  {
    slug: 'pin-bristle-slicker', name: 'Pin & Bristle Slicker', category: 'grooming',
    price_cents: 1600, art: 'brush', size: 'One size', stock: 22,
    blurb: 'Two sides, because coats have two problems.',
    description: 'Bent stainless pins on one face for the undercoat, natural bristle on the other for the finishing pass.',
    detail: 'Brush in the direction of growth, then against it at the ruff. Empty after each use.',
  },
  {
    slug: 'weekly-ear-cleanser', name: 'Weekly Ear Cleanser', category: 'grooming',
    price_cents: 1000, art: 'bottle', size: '150 ml', stock: 15,
    blurb: 'Fifteen seconds a week beats a vet visit a year.',
    description: 'A non-drying solution with a slim nozzle that reaches a drop deep without going anywhere near the eardrum.',
    detail: 'Fill the canal, massage the base for ten seconds, let them shake, wipe. Never use cotton buds.',
  },
  {
    slug: 'reflective-webbing-collar', name: 'Reflective Webbing Collar', category: 'walk',
    price_cents: 1750, art: 'collar', size: 'S / M / L', stock: 27, featured: 1,
    blurb: 'Visible from a car door at fifty metres.',
    description: 'Two-layer webbing with a retroreflective weave, a buckle that will not snap under a squirrel-sized lunge, and a stainless D-ring.',
    detail: 'Measure neck, add 5 cm. Sizes: S 20–30 cm, M 30–42 cm, L 42–55 cm.',
  },
  {
    slug: 'hands-free-running-lead', name: 'Hands-Free Running Lead', category: 'walk',
    price_cents: 2200, art: 'lead', size: '1.5 m', stock: 12,
    blurb: 'Your waist, their enthusiasm, one elastic buffer.',
    description: 'A padded belt with a bungee section that absorbs the worst of a sudden interest in something on the other side of the road.',
    detail: 'Waist 70–120 cm. Bungee absorbs shock to around 30 kg of pull. Not for dogs over 35 kg.',
  },
  {
    slug: 'wool-bolster-bed', name: 'Wool Bolster Bed', category: 'beds',
    price_cents: 6800, art: 'bed', size: 'M / L', stock: 6,
    blurb: 'The wall they lean against when the house is quiet.',
    description: 'A wool-blend shell over a high-resilience core, with a bolster that keeps its shape and a cover that comes off in one piece.',
    detail: 'Machine washable cover at 30°C. Core is not. Sizes: M 70×50 cm, L 90×65 cm.',
  },
  {
    slug: 'recycled-wool-blanket', name: 'Recycled Wool Blanket', category: 'beds',
    price_cents: 3400, art: 'blanket', size: '120×80 cm', stock: 9,
    blurb: 'For the floor, the boot, or the armchair they were told not to.',
    description: 'Woven from reclaimed wool, heavy enough to stay where it is put, and warm enough that the dog stops circling.',
    detail: 'Wool-rich, 70% recycled. Cool wash, dry flat.',
  },
];

const SERVICES = [
  {
    slug: 'bath-blast', name: 'Bath & Blast', sort: 1, duration: 45,
    tagline: 'The reset button.',
    summary: 'Warm soak, conditioner, and a high-velocity dry that gets water out of the coat instead of moving it around.',
    price_small: 2800, price_medium: 3400, price_large: 4200,
    includes: ['Oat shampoo and conditioner', 'High-velocity blow-dry', 'Full brush-out', 'Ear wipe and eye tidy', 'Finishing cologne'],
    note: 'Add a de-shed pass if your dog is currently re-decorating the house.',
  },
  {
    slug: 'full-groom', name: 'Full Groom', sort: 2, duration: 90,
    tagline: 'Bath, blast, and a proper haircut.',
    summary: 'Everything in the Bath & Blast plus a clip to breed shape — or to the shape you asked for, drawn on a photo and everything.',
    price_small: 4500, price_medium: 5800, price_large: 7400,
    includes: ['Everything in Bath & Blast', 'Full haircut to breed or breed-adjacent shape', 'Nail trim and file', 'Paw pad and sanitary tidy', 'Bandana or bow'],
    note: 'Bring a photo if you have a shape in mind. We will tell you honestly if the coat will hold it.',
  },
  {
    slug: 'puppy-intro', name: 'Puppy Intro Groom', sort: 3, duration: 40, flat: 1,
    price_small: 2400, price_medium: 2400, price_large: 2400,
    tagline: 'The first ten minutes of a lifetime of easy grooms.',
    summary: 'Short, gentle, and mostly about the table. No clippers under six months — we handle, praise, dry and stop while it is still fun.',
    includes: ['Gentle bath and towel dry', 'Table and handling practice', 'Nail trim if tolerated', 'Lots of treats', 'A note home on what worked'],
    note: 'Book this before the first shed. The dog that learns grooming at twelve weeks is the easy dog at twelve months.',
  },
  {
    slug: 'nail-clinic', name: 'Nail Clinic', sort: 4, duration: 15, flat: 1,
    price_small: 1200, price_medium: 1200, price_large: 1200,
    tagline: 'Fifteen minutes, no appointment drama.',
    summary: 'Trim, file, quick check and a paw-pad tidy. Walk in during opening hours or grab the next online slot.',
    includes: ['Trim and file', 'Paw pad tidy', 'Quick inspection', 'Grinder option'],
    note: 'Nails should not click on a hard floor. If they do, this is the appointment.',
  },
  {
    slug: 'de-shed-treatment', name: 'De-shed Treatment', sort: 5, duration: 60,
    tagline: 'For double coats and the sofa they own.',
    summary: 'An undercoat rake, a de-shedding bath and a high-velocity dry that finishes the job your vacuum started.',
    price_small: 3800, price_medium: 4600, price_large: 5500,
    includes: ['Undercoat rake pass', 'De-shedding bath and soak', 'High-velocity dry', 'Blade finish where appropriate'],
    note: 'Twice a year for most double coats; every eight weeks for Huskies, Goldens and anyone who denies owning a shedder.',
  },
];

const ADDONS = [
  ['teeth-brush', 'Teeth brushing', 'Enzymatic paste and a soft brush.', 600, 1],
  ['blueberry-facial', 'Blueberry facial scrub', 'For the beard that stains.', 700, 2],
  ['undercoat-rake', 'Undercoat rake', 'Add to any bath for a moulting dog.', 900, 3],
  ['flea-tick-bath', 'Flea & tick bath', 'Veterinary-grade, fully rinsed.', 1200, 4],
  ['pawlish', 'Pawlish', 'Dog-safe nail colour. Water-based, quick-dry.', 800, 5],
  ['bandana', 'Bandana or bow', 'Included in Full Groom, add it elsewhere.', 400, 6],
];

const ADMIN_EMAIL = 'admin@snipandsnout.co.uk';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'groom1234';

function hashPassword(password, salt) {
  return crypto.scryptSync(password, salt, 64).toString('hex');
}

function seed(force = false) {
  const count = db.get('SELECT COUNT(*) AS n FROM products').n;

  if (count > 0 && !force) return { seeded: false };

  db.tx(() => {
    if (force) {
      db.run('DELETE FROM bookings');
      db.run('DELETE FROM orders');
      db.run('DELETE FROM sessions');
      db.run('DELETE FROM products');
      db.run('DELETE FROM addons');
      db.run('DELETE FROM services');
      db.run('DELETE FROM categories');
      db.run('DELETE FROM admins');
    }

    const catIds = {};
    for (const [slug, name, sort] of CATEGORIES) {
      db.run('INSERT INTO categories (slug, name, sort) VALUES (?, ?, ?)', slug, name, sort);
      catIds[slug] = db.get('SELECT id FROM categories WHERE slug = ?', slug).id;
    }

    for (const p of PRODUCTS) {
      db.run(
        `INSERT INTO products (slug, name, category_id, price_cents, blurb, description, detail, size, art, stock, featured, active)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`,
        p.slug, p.name, catIds[p.category], p.price_cents,
        p.blurb, p.description, p.detail, p.size, p.art, p.stock, p.featured || 0
      );
    }

    for (const s of SERVICES) {
      db.run(
        `INSERT INTO services (slug, name, tagline, summary, duration_min, price_small, price_medium, price_large, flat_price, includes, note, sort, active)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`,
        s.slug, s.name, s.tagline, s.summary, s.duration,
        s.price_small, s.price_medium, s.price_large, s.flat || 0,
        JSON.stringify(s.includes), s.note, s.sort
      );
    }

    for (const [slug, name, summary, price, sort] of ADDONS) {
      db.run(
        'INSERT INTO addons (slug, name, summary, price_cents, active, sort) VALUES (?, ?, ?, ?, 1, ?)',
        slug, name, summary, price, sort
      );
    }

    const salt = crypto.randomBytes(16).toString('hex');
    db.run(
      'INSERT INTO admins (email, pass_hash, pass_salt, name) VALUES (?, ?, ?, ?)',
      ADMIN_EMAIL, hashPassword(ADMIN_PASSWORD, salt), salt, 'Marta, front desk'
    );
  });

  return { seeded: true };
}

if (require.main === module) {
  const force = process.argv.includes('--force');
  const out = seed(force);
  console.log(out.seeded ? 'Database reseeded.' : 'Database already has data; use --force to rebuild.');
}

module.exports = { seed, ADMIN_EMAIL, ADMIN_PASSWORD, hashPassword };
