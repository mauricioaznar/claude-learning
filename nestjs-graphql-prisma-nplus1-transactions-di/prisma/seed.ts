import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

// Small deterministic-ish generators so the seed is varied but repeatable enough.
const FIRST = ['Ada', 'Grace', 'Alan', 'Linus', 'Edsger', 'Donald', 'Barbara', 'Ken', 'Dennis', 'Margaret', 'Tim', 'Guido', 'James', 'Bjarne', 'John', 'Leslie', 'Vint', 'Radia', 'Anita', 'Katherine'];
const LAST = ['Lovelace', 'Hopper', 'Turing', 'Torvalds', 'Dijkstra', 'Knuth', 'Liskov', 'Thompson', 'Ritchie', 'Hamilton', 'Berners-Lee', 'van Rossum', 'Gosling', 'Stroustrup', 'McCarthy', 'Lamport', 'Cerf', 'Perlman', 'Borg', 'Johnson'];
const TOPICS = ['Systems', 'Algorithms', 'Networks', 'Compilers', 'Types', 'Concurrency', 'Databases', 'Security', 'Graphics', 'Distributed Things'];
const COMMENTS = ['Loved it', 'A bit dry', 'Changed how I think', 'Too long', 'Instant classic', 'Would recommend', 'Dense but worth it', 'Skimmed the middle'];

function pick<T>(arr: T[], i: number): T {
  return arr[i % arr.length];
}

async function main() {
  // Clean slate every run so counts are predictable.
  await prisma.review.deleteMany();
  await prisma.book.deleteMany();
  await prisma.author.deleteMany();

  let bookCount = 0;
  let reviewCount = 0;

  for (let a = 0; a < 20; a++) {
    const name = `${pick(FIRST, a)} ${pick(LAST, a)}`;
    const nBooks = 2 + (a % 3); // 2..4 books

    const author = await prisma.author.create({ data: { name } });

    for (let b = 0; b < nBooks; b++) {
      const title = `${pick(TOPICS, a + b)}, Vol. ${b + 1}`;
      const book = await prisma.book.create({
        data: { title, authorId: author.id },
      });
      bookCount++;

      const nReviews = 2 + ((a + b) % 3); // 2..4 reviews
      for (let r = 0; r < nReviews; r++) {
        await prisma.review.create({
          data: {
            rating: 1 + ((a + b + r) % 5), // 1..5
            comment: pick(COMMENTS, a + b + r),
            bookId: book.id,
          },
        });
        reviewCount++;
      }
    }
  }

  console.log(`Seeded 20 authors, ${bookCount} books, ${reviewCount} reviews.`);
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
