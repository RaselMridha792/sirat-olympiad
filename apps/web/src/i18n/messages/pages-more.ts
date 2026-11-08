import { defineMessages } from '../messages.ts';

/*
 * The multi-page public site, part 2 (owner, 2026-11-08): Ambassadors, Gallery, FAQ, Contact. Bangla from the
 * client's PDFs (the FAQ's registration answers are the website PDF's, its blanks filled from content and the API);
 * how ambassadors, results, certificates and payments work comes from the system (06-API, the policy texts). Nothing
 * the system lacks is promised: no points-to-cash, no application form, no SMS. English is our translation.
 */
export const morePagesMessages = defineMessages({
  en: {
    ambassador: {
      title: 'Ambassador programme',
      metaDescription:
        'Represent the Sirat Olympiad at your institution and in your area: what ambassadors do, and how it works.',
      hero: {
        kicker: 'Ambassadors',
        title: 'Ambassador programme',
        lead: 'For college and university students: bring the olympiad to your institution and your area.',
      },
      how: {
        kicker: 'How it works',
        title: 'Once you are an ambassador',
        items: [
          {
            title: 'Your own promo code',
            text: 'When the organisers make your account an ambassador account, your dashboard shows your own promo code.',
          },
          {
            title: 'Referrals',
            text: 'When someone gives your code at registration and their payment succeeds, it counts as your referral. A code never changes the fee.',
          },
          {
            title: 'Points and levels',
            text: 'Successful referrals and approved tasks add points, and your dashboard shows your level by points.',
          },
          {
            title: 'Tasks',
            text: 'The organisers give tasks. Points are added only after the organisers approve what you submit.',
          },
          {
            title: 'Teams',
            text: 'You can start a team of your own; others join it with the team’s code.',
          },
        ],
      },
    },
    gallery: {
      title: 'Gallery',
      metaDescription: 'Moments and numbers from the last season of the Sirat Olympiad.',
      hero: {
        kicker: 'Gallery',
        title: 'Moments from last season',
        lead: 'Last season in numbers, and its photos.',
      },
      soon: 'The album of last season’s photos will be added here soon.',
    },
    faq: {
      title: 'Frequently asked questions',
      metaDescription:
        'Answers about registration and the fee, the exam and the syllabus, results and certificates, payment and ambassadors.',
      hero: {
        kicker: 'Questions and answers',
        title: 'Frequently asked questions',
        lead: 'Registration, the exam, results, payment and ambassadors.',
      },
      groups: {
        registration: 'Registration and fee',
        exam: 'The exam and the syllabus',
        results: 'Results and certificates',
        payment: 'Payment',
        ambassador: 'Ambassadors',
      },
      how: {
        question: 'How do I register?',
        answer:
          'Open the registration page, fill in the form with the required details and complete the payment. That completes your registration.',
      },
      deadline: {
        question: 'When does registration close?',
        answer: (date: string) =>
          `Registration closes on ${date}. Complete your registration in time.`,
      },
      fee: {
        question: 'How much is the registration fee?',
        answer: (fee: string) =>
          `The registration fee is ${fee}. The registration form shows it too.`,
        unknown: 'The fee is shown on the registration form.',
      },
      results: {
        question: 'When and where do I see my result?',
        answer:
          'Results are published after the exam window has closed for everyone. Then you see your own score, your answers and the correct answers on your dashboard.',
      },
      certificate: {
        question: 'Will I get a certificate?',
        answer:
          'Yes. Certificates are issued online, and you find yours on your dashboard. Anyone with a certificate’s code can check that it is real.',
      },
      stuck: {
        question: 'Money was taken, but my registration is not confirmed.',
        answer:
          'Your registration is complete only after PayStation confirms the payment. If money was taken but you did not get a confirmation, please do not pay again: write to us with your invoice number, and we will check it.',
      },
      refund: {
        question: 'Can the registration fee be refunded?',
        answer:
          'The registration fee is non-refundable. The exceptions, such as being charged twice for the same registration, are in the refund policy.',
      },
      who: {
        question: 'Who can become an ambassador?',
        answer:
          'College and university students can bring the olympiad to their institution and area, alone or with a team.',
      },
      points: {
        question: 'When are referral points added?',
        answer: 'Referral points are added only after the referred participant’s payment succeeds.',
      },
      links: {
        participate: 'How to take part',
        refund: 'Refund policy',
        contact: 'Contact',
        ambassador: 'The ambassador programme',
      },
    },
    contact: {
      title: 'Contact',
      metaDescription: 'Contact the Sirat Olympiad: email and social media.',
      hero: {
        kicker: 'Contact',
        title: 'Contact us',
        lead: 'Find us by email and on social media.',
      },
      help: {
        kicker: 'Before you write',
        title: 'This helps us answer faster',
        payment: {
          title: 'A payment problem',
          text: 'Give your invoice number and the email or mobile number you registered with. If money was taken but you did not get a confirmation, please do not pay again.',
        },
        reply: {
          title: 'When we reply',
          text: 'Messages are usually answered within 24 hours.',
        },
        faq: {
          title: 'Questions others asked',
          text: 'Many answers are already on the FAQ page.',
          link: 'Frequently asked questions',
        },
      },
    },
  },
  bn: {
    ambassador: {
      title: 'অ্যাম্বাসেডর প্রোগ্রাম',
      metaDescription:
        'নিজের প্রতিষ্ঠান ও এলাকায় সিরাত অলিম্পিয়াডের প্রতিনিধি হন: অ্যাম্বাসেডররা কী করেন, আর কীভাবে কাজ চলে।',
      hero: {
        kicker: 'অ্যাম্বাসেডর',
        title: 'অ্যাম্বাসেডর প্রোগ্রাম',
        lead: 'কলেজ ও বিশ্ববিদ্যালয়ের শিক্ষার্থীদের জন্য: নিজের প্রতিষ্ঠান ও এলাকায় অলিম্পিয়াড পৌঁছে দিন।',
      },
      how: {
        kicker: 'যেভাবে কাজ চলে',
        title: 'অ্যাম্বাসেডর হলে',
        items: [
          {
            title: 'নিজস্ব প্রোমো কোড',
            text: 'আয়োজকেরা আপনার অ্যাকাউন্টকে অ্যাম্বাসেডর অ্যাকাউন্ট করে দিলে ড্যাশবোর্ডে আপনার নিজস্ব প্রোমো কোড দেখা যাবে।',
          },
          {
            title: 'রেফারেল',
            text: 'কেউ রেজিস্ট্রেশনের সময় আপনার কোড দিলে আর তাঁর পেমেন্ট সফল হলে সেটি আপনার রেফারেল হিসেবে গোনা হয়। কোড দিলে ফি বদলায় না।',
          },
          {
            title: 'পয়েন্ট ও লেভেল',
            text: 'সফল রেফারেল আর অনুমোদিত টাস্কে পয়েন্ট যোগ হয়; পয়েন্ট অনুযায়ী আপনার লেভেল ড্যাশবোর্ডে দেখা যায়।',
          },
          {
            title: 'টাস্ক',
            text: 'আয়োজকেরা টাস্ক দেন। আপনার জমা দেওয়া কাজ আয়োজকেরা অনুমোদন করলে তবেই পয়েন্ট যোগ হয়।',
          },
          {
            title: 'দল',
            text: 'চাইলে নিজের একটি দল গড়তে পারেন; অন্যরা দলের কোড দিয়ে যোগ দেন।',
          },
        ],
      },
    },
    gallery: {
      title: 'গ্যালারি',
      metaDescription: 'সিরাত অলিম্পিয়াডের গত আসরের মুহূর্ত আর সংখ্যা।',
      hero: {
        kicker: 'গ্যালারি',
        title: 'গত আসরের মুহূর্ত',
        lead: 'সংখ্যায় গত আসর, আর তার ছবি।',
      },
      soon: 'গত আসরের ছবির অ্যালবাম শিগগিরই এখানে যুক্ত করা হবে।',
    },
    faq: {
      title: 'সচরাচর জিজ্ঞাসা',
      metaDescription:
        'রেজিস্ট্রেশন ও ফি, পরীক্ষা ও সিলেবাস, ফলাফল ও সার্টিফিকেট, পেমেন্ট আর অ্যাম্বাসেডর নিয়ে প্রশ্নের উত্তর।',
      hero: {
        kicker: 'প্রশ্নোত্তর',
        title: 'সচরাচর জিজ্ঞাসা',
        lead: 'রেজিস্ট্রেশন, পরীক্ষা, ফলাফল, পেমেন্ট আর অ্যাম্বাসেডর।',
      },
      groups: {
        registration: 'রেজিস্ট্রেশন ও ফি',
        exam: 'পরীক্ষা ও সিলেবাস',
        results: 'ফলাফল ও সার্টিফিকেট',
        payment: 'পেমেন্ট',
        ambassador: 'অ্যাম্বাসেডর',
      },
      how: {
        question: 'রেজিস্ট্রেশন কীভাবে করব?',
        answer:
          'রেজিস্ট্রেশন লিংকে প্রবেশ করে প্রয়োজনীয় তথ্য দিয়ে ফরম পূরণ করুন এবং পেমেন্ট সম্পন্ন করুন। এর মাধ্যমেই রেজিস্ট্রেশন সম্পন্ন হবে।',
      },
      deadline: {
        question: 'রেজিস্ট্রেশনের শেষ তারিখ কবে?',
        answer: (date: string) =>
          `রেজিস্ট্রেশনের সর্বশেষ তারিখ ${date}। নির্ধারিত সময়ের মধ্যে রেজিস্ট্রেশন সম্পন্ন করুন।`,
      },
      fee: {
        question: 'রেজিস্ট্রেশন ফি কত?',
        answer: (fee: string) => `রেজিস্ট্রেশন ফি ${fee}। রেজিস্ট্রেশন ফরমেও ফি দেখানো হয়।`,
        unknown: 'রেজিস্ট্রেশন ফরমে ফি দেখানো হয়।',
      },
      results: {
        question: 'ফল কবে আর কোথায় জানা যাবে?',
        answer:
          'সবার জন্য পরীক্ষার সময় শেষ হওয়ার পরে ফল প্রকাশ হয়। তখন নিজের ড্যাশবোর্ডে আপনার নম্বর, আপনার উত্তর আর সঠিক উত্তর দেখতে পাবেন।',
      },
      certificate: {
        question: 'সার্টিফিকেট পাওয়া যাবে কি?',
        answer:
          'হ্যাঁ। সার্টিফিকেট অনলাইনে দেওয়া হয়; নিজেরটি পাবেন আপনার ড্যাশবোর্ডে। সার্টিফিকেটের কোড থাকলে যে কেউ যাচাই করতে পারে সেটি আসল কি না।',
      },
      stuck: {
        question: 'টাকা কেটেছে, কিন্তু রেজিস্ট্রেশন নিশ্চিত হয়নি।',
        answer:
          'PayStation পেমেন্ট নিশ্চিত করার পরেই রেজিস্ট্রেশন সম্পূর্ণ হয়। টাকা কেটে নেওয়া হয়েছে অথচ নিশ্চিতকরণ পাননি, এমন হলে আবার পেমেন্ট করবেন না: ইনভয়েস নম্বরসহ আমাদের লিখুন, আমরা দেখে নেব।',
      },
      refund: {
        question: 'রেজিস্ট্রেশন ফি ফেরত পাওয়া যায় কি?',
        answer:
          'রেজিস্ট্রেশন ফি ফেরতযোগ্য নয়। ব্যতিক্রমগুলো, যেমন একই রেজিস্ট্রেশনের জন্য একাধিকবার টাকা কাটা হলে, ফেরত নীতিতে দেওয়া আছে।',
      },
      who: {
        question: 'কারা অ্যাম্বাসেডর হতে পারেন?',
        answer:
          'কলেজ ও বিশ্ববিদ্যালয় পর্যায়ের শিক্ষার্থীরা নিজের প্রতিষ্ঠান ও এলাকায় অলিম্পিয়াড পৌঁছে দিতে পারেন, এককভাবে বা দল গঠন করে।',
      },
      points: {
        question: 'রেফারেল পয়েন্ট কখন যোগ হয়?',
        answer: 'রেফারেল পয়েন্ট যোগ হয় কেবল রেফার করা অংশগ্রহণকারীর পেমেন্ট সফল হওয়ার পর।',
      },
      links: {
        participate: 'কীভাবে অংশ নেবেন',
        refund: 'ফেরত নীতি',
        contact: 'যোগাযোগ',
        ambassador: 'অ্যাম্বাসেডর প্রোগ্রাম',
      },
    },
    contact: {
      title: 'যোগাযোগ',
      metaDescription: 'সিরাত অলিম্পিয়াডের সঙ্গে যোগাযোগ: ইমেইল আর সোশ্যাল মিডিয়া।',
      hero: {
        kicker: 'যোগাযোগ',
        title: 'আমাদের সাথে যোগাযোগ করুন',
        lead: 'ইমেইল আর সোশ্যাল মিডিয়ায় আমাদের পাবেন।',
      },
      help: {
        kicker: 'লেখার আগে',
        title: 'যা দিলে দ্রুত উত্তর দিতে পারি',
        payment: {
          title: 'পেমেন্টের সমস্যা',
          text: 'ইনভয়েস নম্বর আর রেজিস্ট্রেশনে দেওয়া ইমেইল বা মোবাইল নম্বর দিন। টাকা কেটে নেওয়া হয়েছে অথচ নিশ্চিতকরণ পাননি, এমন হলে আবার পেমেন্ট করবেন না।',
        },
        reply: {
          title: 'কখন উত্তর পাবেন',
          text: 'বার্তার উত্তর সাধারণত ২৪ ঘণ্টার মধ্যে দেওয়া হয়।',
        },
        faq: {
          title: 'অন্যরা যা জিজ্ঞেস করেছেন',
          text: 'অনেক প্রশ্নের উত্তর প্রশ্নোত্তর পাতায় আছে।',
          link: 'সচরাচর জিজ্ঞাসা',
        },
      },
    },
  },
});
