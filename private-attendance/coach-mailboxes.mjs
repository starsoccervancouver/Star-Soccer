// These are the existing, verified Coach Desk sign-ins, not their shared Gmail aliases.
const coachMailboxes = new Map([
 ['evan.lycos@gmail.com', 'evan@starsoccer.ca'],
 ['vdinglis@gmail.com', 'valentinos@starsoccer.ca']
]);
export const coachMailbox = actor => actor.role === 'owner' ? undefined : coachMailboxes.get(actor.email.toLowerCase());

export function addressedToCoach(to, mailbox) {
  const addresses = to.replace(/"(?:[^"\\]|\\.)*"/g,'').split(',').map(value=>{
      const address=value.trim().match(/^(?:[^<>]*<([^<>]+)>|([^<>\s]+))$/);
      return (address?.[1]||address?.[2]||'').toLowerCase();
    });
  return mailbox ? addresses.includes(mailbox) : addresses.some(address=>[...coachMailboxes.values()].includes(address));
}
