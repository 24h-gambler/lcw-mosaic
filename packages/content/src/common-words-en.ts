/**
 * Everyday English words a child may start a sentence with ("Yesterday I played soccer", "Pizza is my favorite food").
 * Used by the parent report's first-word name check (apps/edge parent-report publicSafeText): a sentence whose first
 * word is not an ordinary word is treated as starting with a name and kept off the forwardable report.
 *
 * Hand-curated for children's speech (time, family, school, food, animals, play, feelings, common verbs/adjectives).
 * Words that are also common given names (joy, grace, hope, rose, lily, ruby, sky, jack, mark, bill, ray …) are left out
 * on purpose — see NAME_LIKE_WORDS and the test that keeps the two apart. Lowercase, no apostrophes ("dont", "lets").
 */
const RAW = `
yes yeah yep no nope okay ok alright well so oh ah um uh hmm wow oops yay hi hello hey bye goodbye please thanks
thank sorry excuse wait look listen see watch come go stop help maybe really actually also and but or because if
then now today tonight yesterday tomorrow sometimes always never usually often later soon again once first next last
after before morning afternoon evening night weekend week month year day time everyday every each some many much
more most few lots all both any another other
i me my mine myself you your yours we us our they them their he him his she her it its this that these those there
here what where when who whom whose why how which whatever everyone everybody everything someone somebody something
nobody nothing anyone anything people person
im ive ill id youre were theyre hes shes its thats theres whats lets dont doesnt didnt cant couldnt wont wouldnt
isnt arent wasnt werent havent hasnt shouldnt
is am are was were be been being have has had do does did can could will would shall should may might must
get got make made take took give gave put want wanted need needed like liked love loved hate know knew think thought
feel felt try tried play played run ran walk walked jump jumped swim swam ride rode fly flew climb climbed dance
danced sing sang draw drew paint painted read write wrote cook cooked eat ate drink drank sleep slept wake woke sit
sat stand stood open opened close closed find found lose lost win won buy bought sell sold pay paid bring brought
carry carried throw threw catch caught kick kicked hit build built break broke fix fixed clean cleaned wash washed
brush brushed say said tell told ask asked answer talk talked call called meet met visit visited learn learned
study studied teach taught remember forget forgot finish finished start started begin began keep kept leave left
move moved turn turned show showed share shared trade traded order ordered wear wore hold held hide hid seek
pick picked choose chose count counted spell spelled practice practiced use used hurry
go goes going went gone come comes coming came
big small little tiny huge long short tall high low fast slow hot cold warm cool new old young good bad great nice
fun funny happy sad angry mad scared tired hungry thirsty sleepy sick fine full busy ready sure right wrong easy
hard difficult strong weak loud quiet soft clean dirty wet dry pretty beautiful cute ugly yummy delicious tasty
sweet sour salty spicy favorite best better worst special same different real fake true safe dangerous lucky
excited bored boring interesting awesome cool amazing super perfect free brave kind friendly lonely
red orange yellow green blue purple pink brown black white gray grey gold silver colorful
one two three four five six seven eight nine ten eleven twelve twenty hundred thousand zero half
mom mommy dad daddy mother father parents brother sister grandma grandpa grandmother grandfather family baby kids
kid children child boy boys girl girls man men woman women friend friends teacher teachers student students
classmate neighbor uncle aunt cousin doctor nurse police firefighter farmer chef cook driver pilot king queen
prince princess
school class classroom homework test lesson book books pencil pen paper eraser bag backpack desk chair board
computer phone tablet video toy toys ball balls doll robot puzzle card cards picture music song songs
movie movies show tv
home house room bedroom kitchen bathroom garden yard park playground library store shop market mall cafe
restaurant hospital zoo museum beach sea ocean river lake mountain forest city town street road car cars bus train
plane bike bicycle boat ship taxi subway
food breakfast lunch dinner snack pizza burger hamburger sandwich chicken rice noodles soup bread cake cookie
cookies candy chocolate ice icecream cream cheese egg eggs milk juice water tea coffee apple apples banana bananas
orange grape grapes strawberry strawberries watermelon peach lemon fruit vegetables carrot potato tomato corn salad
fries meat fish pork beef ramen kimchi dessert popcorn donut donuts pancake pancakes cereal yogurt honey
dog dogs puppy cat cats kitty bird birds fish rabbit bunny hamster turtle frog horse cow pig sheep duck chicken
lion tiger bear bears elephant monkey monkeys giraffe zebra panda penguin dolphin shark whale snake dinosaur
dinosaurs dragon bug bugs butterfly bee ant spider mouse animals animal pet pets
soccer baseball basketball football tennis badminton swimming skating skiing taekwondo piano guitar violin drums
sports sport team
sun moon star stars cloud clouds rain snow wind weather sky spring fall winter
head hair face eyes eye ears nose mouth teeth tooth hand hands arm arms leg legs foot feet tummy stomach heart body
shirt pants shoes socks hat cap jacket coat dress clothes glasses umbrella
monday tuesday wednesday thursday friday saturday sunday january february march april may june july august
september october november december english korean korea math science art
unicorn unicorns spaghetti pasta kimbap tteokbokki bibimbap bulgogi dumplings sushi taco tacos hotdog sausage bacon
jelly jellyfish octopus squid crab lobster seal otter fox wolf deer owl parrot goldfish hedgehog koala kangaroo
camel hippo rhino cheetah leopard crocodile alligator lizard ladybug caterpillar worm snail
bubble bubbles balloon balloons kite slide swing sandbox trampoline lego legos blocks minecraft roblox pokemon
slime crayons stickers sticker marker markers scissors glue notebook ruler
cartoon cartoons comic comics youtube video videos phone camera ipad laptop
birthday party present presents gift gifts holiday vacation trip picnic camping festival christmas halloween
water milk juice smoothie lemonade cocoa soda candy gum chips ketchup
lamp table floor wall window door roof stairs bed sofa couch pillow blanket toilet shower
tap press type send set check key word words whole single bunk cozy dining cooking sewing saw wood petals flower
flowers tree trees grass leaf leaves rock rocks sand stone island cave castle tower bridge
instead sounds ooh agreed deal
not very too just only even still almost already together alone inside outside up down in out on off over under
into onto around through across between behind near far away back with without about at by for from of to as than
like until while since during
`;

/** Words that are common given names: never accepted as an ordinary first word ("Joy is my friend" may name a child). */
export const NAME_LIKE_WORDS: readonly string[] = (
  'joy grace hope faith rose lily daisy ruby amber jade pearl iris violet ivy sky sunny jack mark bill ray rich ' +
  'jay dawn crystal heather holly autumn summer river'
).split(' ');

const NAME_LIKE = new Set(NAME_LIKE_WORDS);

export const COMMON_WORDS_EN: readonly string[] = [...new Set(RAW.split(/\s+/).filter(Boolean))].filter((w) => !NAME_LIKE.has(w));
