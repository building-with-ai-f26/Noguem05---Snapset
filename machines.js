// Every machine SnapSet knows: common Planet Fitness strength equipment.
// DRAFT: to be checked against the builder's own gym. Cardio is left out because
// SnapSet logs sets, reps and weight.
//
// Each machine has:
//   aliases    other names people (and the AI) use for it
//   exercises  what you can do on it, each with the muscles it works.
//              One exercise = no buttons, logging stays one tap.
//              "Other" lets you type your own exercise name.

const OTHER = "Other";

const MACHINES = [
  // ---- Legs ----
  { name: "Leg Press", aliases: ["seated leg press", "45-degree leg press", "plate-loaded leg press", "sled"],
    exercises: [["Leg Press", "Quads, glutes"], ["Calf Press", "Calves"]] },
  { name: "Leg Extension", aliases: ["quad extension"],
    exercises: [["Leg Extension", "Quads"]] },
  { name: "Seated Leg Curl", aliases: ["seated hamstring curl"],
    exercises: [["Seated Leg Curl", "Hamstrings"]] },
  { name: "Lying Leg Curl", aliases: ["prone leg curl", "lying hamstring curl"],
    exercises: [["Lying Leg Curl", "Hamstrings"]] },
  { name: "Hip Abductor / Adductor", aliases: ["outer thigh machine", "inner thigh machine", "hip abduction", "hip adduction"],
    exercises: [["Hip Abduction (outer thigh)", "Glutes, outer hips"], ["Hip Adduction (inner thigh)", "Inner thighs"]] },
  { name: "Multi-Hip", aliases: ["standing hip machine", "4-way hip"],
    exercises: [["Hip Extension", "Glutes, hamstrings"], ["Hip Flexion", "Hip flexors"], ["Hip Abduction", "Glutes, outer hips"], ["Hip Adduction", "Inner thighs"]] },
  { name: "Glute Kickback Machine", aliases: ["glute machine", "glute isolator"],
    exercises: [["Glute Kickback", "Glutes"]] },
  { name: "Hip Thrust Machine", aliases: ["glute bridge machine", "glute drive"],
    exercises: [["Hip Thrust", "Glutes, hamstrings"]] },
  { name: "Calf Raise Machine", aliases: ["seated calf raise", "standing calf raise"],
    exercises: [["Calf Raise", "Calves"]] },
  { name: "Hack Squat", aliases: ["hack squat machine", "angled squat"],
    exercises: [["Hack Squat", "Quads, glutes"], ["Reverse Hack Squat", "Glutes, hamstrings"]] },

  // ---- Chest ----
  { name: "Chest Press", aliases: ["seated chest press", "plate-loaded chest press", "Hammer Strength chest press"],
    exercises: [["Chest Press", "Chest, triceps"]] },
  { name: "Incline Chest Press", aliases: ["incline press machine"],
    exercises: [["Incline Chest Press", "Upper chest, shoulders, triceps"]] },
  { name: "Pec Fly / Rear Delt", aliases: ["pec deck", "butterfly machine", "rear delt fly machine"],
    exercises: [["Pec Fly", "Chest"], ["Rear Delt Fly", "Rear shoulders, upper back"]] },

  // ---- Back ----
  { name: "Lat Pulldown", aliases: ["pulldown machine", "high row", "plate-loaded high row"],
    exercises: [["Lat Pulldown", "Back (lats), biceps"], ["Close-Grip Pulldown", "Back (lats), biceps"]] },
  { name: "Seated Row", aliases: ["row machine", "mid row", "low row", "plate-loaded row"],
    exercises: [["Seated Row", "Upper back, biceps"]] },
  { name: "T-Bar Row", aliases: ["chest-supported T-bar row"],
    exercises: [["T-Bar Row", "Upper back, lats, biceps"]] },
  { name: "Pullover Machine", aliases: ["lat pullover"],
    exercises: [["Pullover", "Lats, chest"]] },
  { name: "Back Extension", aliases: ["lower back machine", "hyperextension bench", "45-degree back extension"],
    exercises: [["Back Extension", "Lower back, glutes"]] },
  { name: "Assisted Pull-up / Dip", aliases: ["assisted chin-up", "assisted dip", "gravitron"],
    exercises: [["Assisted Pull-up", "Back (lats), biceps"], ["Assisted Chin-up", "Back (lats), biceps"], ["Assisted Dip", "Chest, triceps"]] },

  // ---- Shoulders and arms ----
  { name: "Shoulder Press", aliases: ["overhead press machine", "military press machine"],
    exercises: [["Shoulder Press", "Shoulders, triceps"]] },
  { name: "Lateral Raise Machine", aliases: ["side raise machine", "deltoid raise"],
    exercises: [["Lateral Raise", "Side shoulders"]] },
  { name: "Biceps Curl Machine", aliases: ["arm curl machine", "preacher curl machine"],
    exercises: [["Biceps Curl", "Biceps"]] },
  { name: "Triceps Extension Machine", aliases: ["triceps press machine"],
    exercises: [["Triceps Extension", "Triceps"]] },
  { name: "Seated Dip Machine", aliases: ["triceps dip machine"],
    exercises: [["Seated Dip", "Triceps, chest"]] },

  // ---- Core ----
  { name: "Ab Crunch Machine", aliases: ["abdominal crunch", "ab machine"],
    exercises: [["Ab Crunch", "Abs"]] },
  { name: "Torso Rotation", aliases: ["rotary torso", "oblique twist machine"],
    exercises: [["Torso Rotation", "Obliques"]] },
  { name: "Captain's Chair", aliases: ["vertical knee raise", "power tower", "dip station"],
    exercises: [["Knee Raise", "Abs, hip flexors"], ["Dip", "Chest, triceps"], ["Pull-up", "Back (lats), biceps"]] },
  { name: "Ab Coaster", aliases: ["ab glider"],
    exercises: [["Ab Coaster", "Abs"]] },
  { name: "Decline Sit-up Bench", aliases: ["ab bench", "sit-up bench"],
    exercises: [["Decline Sit-up", "Abs"]] },

  // ---- Multi-exercise stations ----
  { name: "Cable Machine", aliases: ["cable tower", "multi-station", "cable crossover", "functional trainer", "dual adjustable pulley"],
    exercises: [["Seated Row", "Upper back, biceps"], ["Lat Pulldown", "Back (lats), biceps"], ["Cable Crossover", "Chest"],
      ["Triceps Pushdown", "Triceps"], ["Face Pull", "Rear shoulders, upper back"], ["Biceps Curl", "Biceps"],
      ["Glute Kickback", "Glutes"], [OTHER, ""]] },
  { name: "Smith Machine", aliases: ["guided barbell"],
    exercises: [["Squat", "Quads, glutes"], ["Bench Press", "Chest, triceps"], ["Incline Bench Press", "Upper chest, shoulders"],
      ["Shoulder Press", "Shoulders, triceps"], ["Lunge", "Quads, glutes"], ["Hip Thrust", "Glutes, hamstrings"], [OTHER, ""]] },
].map(({ name, aliases, exercises }) => ({
  name,
  aliases,
  exercises: exercises.map(([exercise, muscles]) => ({ name: exercise, muscles })),
}));

const BY_NAME = new Map(MACHINES.map((m) => [m.name, m]));

module.exports = { MACHINES, BY_NAME, OTHER };
