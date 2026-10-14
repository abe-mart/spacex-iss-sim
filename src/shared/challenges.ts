export const CHALLENGES = {
  standard:{name:'Standard docking',brief:'Normal instruments and controls. Scores count toward the main leaderboard.'},
  noise:{name:'Noisy instruments',brief:'Position readings vary by up to 0.5 m and velocity by 0.03 m/s. Filter readings over time. The physical ship and docking criteria are unchanged.'},
  broken:{name:'Broken thruster',brief:'The translate_left thruster produces no force. Use the remaining thrusters and ship attitude to compensate.'},
  scrambled:{name:'Scrambled controls',brief:'Translation commands are mapped to different translation thrusters. Discover the mapping with small pulses. Rotation controls work normally.'},
} as const;
export type Challenge = keyof typeof CHALLENGES;
