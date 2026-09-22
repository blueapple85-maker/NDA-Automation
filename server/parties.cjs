function noteAddressee(facts,input){
  return facts.parties.filter(p=>p.id!==input.companyId).map(p=>(p.shortName||p.name).replace(/[\[\]:\r\n]/g,' ').trim()).join(', ');
}
module.exports={noteAddressee};
