const date='2027-01-12',today='2027-01-06',recipient='owner@example.test';
const row=(id,fields)=>({id,fields});
function fixture(template,to=recipient){
 const d={bookings:[],payments:[],allocations:[],families:[row('family',{Email:to})],players:[],registrations:[],attendance:[],sessions:[],templates:[row('master',{Template:'Camp Email Master',Version:'REVIEW05 / Pro-D',HTML:template})],enrollments:[],programs:[row('program',{Program:'Example training'})],suppression:[],draftLog:[],intake:[]};
 for(const [name,paid] of [['Paid',60],['Unpaid',0],['Partial',20]]){
  d.players.push(row(name,{Player:'Example '+name,Family:['family']}));
  d.bookings.push(row(name,{'Booking reference':'SS-TEST-'+name.toUpperCase(),'Booking status':'Accepted','Start date':date,Player:[name],Family:['family'],'Charge review':'Agreed','Charge CAD':60,'Verified applied CAD':paid}));
  d.sessions.push(row(name,{Session:'Example training',Date:date,Time:'3–4 PM',Venue:'Example field','Session status':'Planned','Weekly program':['program']}));
  d.attendance.push(row(name,{Booking:[name],Player:[name],Session:[name],'Coverage state':'Active','Session date':date}));
  if(paid)d.allocations.push(row(name,{Booking:[name],Payment:['siblings'],'Amount CAD':paid,'Applied CAD':paid,'Review status':'Verified allocation'}));
 }
 d.payments.push(row('siblings',{'Payment reference':'TEST-SIBLINGS',Family:['family'],Verification:'Verified',Direction:'Incoming',Method:'E-transfer','Payment date':today,'Amount CAD':80}));
 d.payments.push(row('cash',{'Payment reference':'TEST-CASH',Family:['family'],Verification:'Verified',Direction:'Incoming',Method:'Cash','Payment date':today,'Amount CAD':25}));
 d.enrollments.push(row('active',{'Enrollment status':'Active','Billing approval':'Approved','Approved coverage expiry':date,'Renewal guidance':'Reply to your coach','Weekly program':['program'],Player:['Unpaid'],Family:['family']}));
 d.enrollments.push(row('renewed',{...d.enrollments[0].fields,Player:['Partial'],'Prepaid covered until':'2027-02-12'}));
 return d;
}
module.exports={fixture,today,date};
